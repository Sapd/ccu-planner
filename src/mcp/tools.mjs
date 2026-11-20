// The MCP tools as plain handlers: handler(deps, args, ctx) -> { text, data }. No SDK code here, so the tests call
// them directly; server.mjs registers them.
//
// deps (everything with side effects is injected):
//   load()            a fresh app object { data, graph, plans, overrides, saleEvents, expected, session } of the data folder
//   snapshots()       the stored plan snapshots (plan-snapshots.json), oldest first
//   save(name, doc)   revisioned save of 'plans' | 'overrides' | 'sale-events'; false when the file moved on (stale rev)
//   readFile(path)    text of one file (compare_ccugame only)
//   sync              { available(): boolean, run(cmd, options, { onProgress, signal }): Promise<{ requests, seconds }> }
//   now()             a Date
//   aliases           the ship aliases (compare_ccugame)
// ctx: { progress(event), signal } of the running request (both optional).
//
// This file has no code that buys, melts, gifts or applies anything on RSI, and none that touches the cart or buyback.
import { isAbsolute } from 'node:path';
import * as z from 'zod/v4';
import { todayView } from '../../app/src/lib/view/today.mjs';
import { applyAction } from '../logic/state.mjs';
import { userSaleEvents } from '../logic/feed.mjs';
import { whatIf, summarize, assertBuyable } from '../logic/whatif.mjs';
import { addGoalText, removeGoalText, buyRowText, otherGoalsText, signed, offerCheckLines } from '../logic/whatifText.mjs';
import { checkOffer, parseOfferText } from '../logic/offerCheck.mjs';
import { compareCcuGame } from '../logic/ccugameCompare.mjs';
import { ownedInto } from '../logic/ownedInto.mjs';
import { changesSinceSync } from '../logic/changes.mjs';
import { sessionOf } from '../logic/session.mjs';
import { findShip, norm, goalLabel } from '../logic/ships.mjs';
import { localToday } from '../logic/availability.mjs';
import { usd } from '../logic/format.mjs';
import {
  heroBuyTitle, NOTHING_TODAY, BUY_GROUPS, nothingWhyText, eventRiskText, goalStatusText, goalCostText,
  sharedEffectLine, changesHeadline, changesGoalLines, goalChangeLine, storeDataAge, hangarDataAge, meltTipText,
  waitingHeadline, MODE_CHOICE,
} from '../logic/describe.mjs';

/** An error the model should see as a tool error (isError), not a crash. */
export class ToolError extends Error {}

const DOC_NAMES = { plans: 'plans', overrides: 'overrides', saleEvents: 'sale-events' };
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_OFFERS = 10;
const MAX_COPIES = 5;

const shipArg = z.union([z.string().max(200), z.number()]).describe('Ship name (e.g. "Carrack") or numeric ship id');
const goalArg = z.string().max(200).describe('Goal: its name (usually the target ship) or id like c3');
const MAX_DOLLARS = 100000;
const dollars = (what) => z.number().positive().max(MAX_DOLLARS).describe(`${what}, in US dollars (e.g. 12.5)`);
const toCents = (d) => Math.round(d * 100);

// ----- lookups -----

function shipOf(app, query) {
  const s = findShip(app.data.ships, query);
  if (!s) throw new ToolError(`No single ship matches "${query}". Use the full ship name or the numeric id.`);
  return s;
}

function goalOf(app, query) {
  const { plans, data } = app;
  const chains = Object.values(plans.chains ?? {});
  const q = String(query).trim();
  if (Object.hasOwn(plans.chains ?? {}, q)) return plans.chains[q];
  const label = (c) => norm(goalLabel(c, data.ships));
  const exact = chains.filter((c) => label(c) === norm(q) || norm(c.name) === norm(q));
  const hits = exact.length ? exact : chains.filter((c) => label(c).includes(norm(q)) && norm(q));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new ToolError(`No goal matches "${query}". Goals: ${chains.map((c) => goalLabel(c, data.ships)).join(', ') || 'none'}.`);
  throw new ToolError(`"${query}" matches ${hits.length} goals (${hits.map((c) => `${goalLabel(c, data.ships)} [${c.id}]`).join(', ')}). Use the id.`);
}

const nameOf = (app) => (id) => app.data.ships.get(id)?.name ?? 'unknown ship';
const kindWord = (k) => (k === 'warbond' ? 'Warbond' : k === 'standard' ? 'Standard' : 'owned');
const pair = (app, from, to) => `${nameOf(app)(from)} → ${nameOf(app)(to)}`;
const pairData = (app, from, to) => ({ from, fromName: nameOf(app)(from), to, toName: nameOf(app)(to) });
const dataAge = (app, now) => [storeDataAge(app.data.meta?.catalogAt, now), hangarDataAge(app.data.meta?.hangarAt, now)].join('. ');
const dayOf = (deps) => localToday(deps.now());
const stepLine = (app, x) => {
  const s = x.step;
  if (x.state === 'own') return `own: ${pair(app, s.from, s.to)}${s.paid?.cents != null ? ` (paid ${usd(s.paid.cents)})` : ''}`;
  const head = `${pair(app, s.from, s.to)} ${kindWord(s.kind)} ${usd(s.cash)}`;
  if (x.state === 'now') return `${x.urgency === 'norush' ? 'on sale' : x.urgency === 'optional' ? 'optional' : 'buy now'}: ${head}${x.reason ? ` (${x.reason})` : ''}`;
  return `wait: ${head}${x.reason ? ` (${x.reason})` : ''}`;
};

// ----- read-only tools -----

function today(deps) {
  const app = deps.load();
  const day = dayOf(deps);
  const v = todayView(app, day);
  const rows = (bucket) => v.buyList[bucket].map((r) => ({
    bucket, ...pairData(app, r.from, r.to), kind: r.kind, cash: r.cash, count: r.count, goals: r.goals.map((g) => g.name),
    payment: r.payment, onSale: r.onSale || null, reasons: r.reasonTexts, standard: r.standardText,
  }));
  const rowText = (r) => `${r.count}x ${r.fromName} → ${r.toName} ${kindWord(r.kind)} ${usd(r.cash)} each (${r.payment}) for ${r.goals.join(', ')}${r.reasons.length ? `; ${r.reasons.join(', ')}` : ''}${r.onSale ? `; ${r.onSale}` : ''}`;
  const lines = [];
  if (v.empty) {
    lines.push('No goals yet. Add one with the app, the CLI or add_goal (needs --allow-writes).');
  } else {
    const names = new Map(v.goals.map((g) => [g.goalId, g.targetName]));
    if (v.hero.nothing) {
      const risk = v.waiting.notices.filter((n) => n.eventOnly).length;
      const anyNoRoute = v.goals.some((g) => g.status === 'no-route');
      const anyNoToken = v.goals.some((g) => g.status === 'no-token');
      lines.push(`${NOTHING_TODAY}. ${risk > 0 && v.waiting.event ? eventRiskText(risk, v.waiting.event) : nothingWhyText(v.hero.nothingWhy, { waitCount: v.waiting.count, anyNoRoute, anyNoToken })}`);
    } else {
      lines.push(`${heroBuyTitle(v.hero.buyCount, usd(v.hero.buyCash))} (for ${v.hero.goalsTouched.map((id) => names.get(id)).join(', ')})`);
    }
    if (v.hero.otherLine) lines.push(v.hero.otherLine);
    if (v.buyList.creditLine) lines.push(v.buyList.creditLine);
    for (const bucket of ['today', 'norush', 'optional']) {
      const list = rows(bucket);
      if (!list.length) continue;
      lines.push('', `${BUY_GROUPS[bucket].title} (${BUY_GROUPS[bucket].help})`, ...list.map((r) => `- ${rowText(r)}`));
    }
    if (v.buyList.limitedNote) lines.push('', v.buyList.limitedNote);
    if (v.waiting.count) lines.push('', waitingHeadline(v.waiting.count, v.waiting.goals.length));
    if (v.melt) lines.push(meltTipText(v.melt.count, usd(v.melt.credit)));
  }
  lines.push('', dataAge(app, deps.now()));
  return {
    text: lines.join('\n'),
    data: {
      day, empty: v.empty, buyToday: { count: v.hero.buyCount, cash: v.hero.buyCash },
      buy: [...rows('today'), ...rows('norush'), ...rows('optional')],
      waiting: { steps: v.waiting.count, goals: v.waiting.goals.map((id) => v.goals.find((g) => g.goalId === id)?.targetName) },
      melt: v.melt, storeAt: v.catalogAt, hangarAt: v.hangarAt,
    },
  };
}

function goalRow(app, g) {
  const chain = app.plans.chains[g.goalId];
  return {
    id: g.goalId, name: g.targetName, target: g.targetName, status: g.status, priority: chain.priority ?? 'normal', mode: chain.mode ?? 'watch',
    cash: g.cash, aloneCash: g.aloneCash, accepted: !!chain.accepted, buyToday: g.buyCount, noRush: g.noRushCount, optional: g.optionalCount, waiting: g.waitCount,
  };
}

function goals(deps) {
  const app = deps.load();
  const v = todayView(app, dayOf(deps));
  if (v.empty) return { text: 'No goals yet.', data: { goals: [] } };
  const rows = v.goals.map((g) => goalRow(app, g));
  const lines = v.goals.map((g, i) => {
    const r = rows[i];
    const cost = goalCostText(g.cash, g.aloneCash);
    return `- ${r.name} [${r.id}] · ${r.priority} priority · ${MODE_CHOICE[r.mode] ?? r.mode} · ${cost ? `${cost} new money` : 'no route'} · ${goalStatusText(g) || g.status}${r.accepted ? ' · chain reserved' : ''}`;
  });
  const total = rows.reduce((n, r) => n + (r.cash ?? 0), 0);
  lines.push('', `Together: ${usd(total)} new money across ${rows.length} goal(s) (the shared plan; goals share your owned CCUs, tokens and credit).`, dataAge(app, deps.now()));
  return { text: lines.join('\n'), data: { totalCash: total, goals: rows } };
}

function goal(deps, args) {
  const app = deps.load();
  const chain = goalOf(app, args.goal);
  const v = todayView(app, dayOf(deps));
  const g = v.goals.find((x) => x.goalId === chain.id);
  const session = sessionOf(app);
  const name = nameOf(app);
  const label = goalLabel(chain, app.data.ships);
  const lines = [`${label} [${chain.id}] · ${chain.priority ?? 'normal'} priority · ${MODE_CHOICE[chain.mode ?? 'watch']}`];
  if (g.startLine) lines.push(g.startLine);
  const j = g.journey;
  const effect = session.sharedEffect(chain.id);
  const shared = g.cash;
  const alone = effect.alone?.cash ?? null;
  if (shared == null) lines.push(g.status === 'no-token' ? 'No free LTI token for this goal.' : 'No route today.');
  else lines.push(`Cost: ${goalCostText(shared, g.aloneCash) ?? usd(shared)} (new money${chain.accepted ? ` · chain reserved, rev ${chain.accepted.rev}` : ''}).`);
  const share = sharedEffectLine(effect, { name });
  if (share) lines.push(`Sharing: ${share}`);
  else if (shared != null && alone != null) lines.push('Sharing: no extra cost; this goal costs the same alone.');
  if (j.steps.length) {
    lines.push('', 'Route, step by step:');
    j.steps.forEach((x, i) => lines.push(`${i + 1}. ${x.token ? '(LTI token) ' : ''}${stepLine(app, x)}${x.alert ? ` | ${x.alert}` : ''}${x.cover ? ` | ${x.cover}` : ''}`));
    const f = j.figures;
    if (f.ifSales != null) lines.push('', `If the sales come back: about ${usd(f.ifSales)} instead of ${usd(f.today)}.`);
    else if (f.estimate) lines.push('', `Estimate if waiting steps get the usual Warbond discount: about ${usd(f.estimate.typical)} (range ${usd(f.estimate.low)}–${usd(f.estimate.high)}).`);
  }
  const steps = j.steps.map((x) => ({
    state: x.state, ...pairData(app, x.step.from, x.step.to), kind: x.step.kind, cash: x.step.cash ?? null,
    reason: x.reason ?? null, urgency: x.urgency, alert: x.alert, copyId: x.step.copyId ?? null,
  }));
  return {
    text: lines.join('\n'),
    data: { ...goalRow(app, g), accepted: chain.accepted ? { rev: chain.accepted.rev, at: chain.accepted.acceptedAt, cash: chain.accepted.cash } : null, aloneCash: alone, sharedExtra: effect.extra ?? null, steps },
  };
}

function changesSinceSyncTool(deps) {
  const app = deps.load();
  const session = sessionOf(app);
  const c = changesSinceSync(session, deps.snapshots());
  if (!c) return { text: 'No earlier plan snapshot of different data yet, so there is nothing to compare. A snapshot is stored around each sync.', data: { changes: null } };
  const name = nameOf(app);
  const lines = [changesHeadline(c), ...c.goals.map((g) => `- ${goalChangeLine(g, { name })}`), ...changesGoalLines(c)];
  if (!c.goals.length && !c.added.length && !c.removed.length) lines.push('No goal changed its cost.');
  return {
    text: lines.join('\n'),
    data: {
      since: c.since, total: c.total, was: c.was, totalDelta: c.totalDelta,
      goals: c.goals.map((g) => ({ goalId: g.goalId, name: g.name, was: g.was, now: g.now, delta: g.delta, causes: g.causes })), added: c.added, removed: c.removed,
    },
  };
}

function whatIfTool(deps, args, ctx = {}) {
  const app = deps.load();
  const given = ['add_goal', 'remove_goal', 'buy', 'price'].filter((k) => args[k] != null);
  if (given.length !== 1) throw new ToolError('Give exactly one change: add_goal, remove_goal, buy or price.');
  const kind = given[0];
  let change;
  if (kind === 'add_goal') {
    const a = args.add_goal;
    const start = a.start != null ? { kind: 'ship', ship: shipOf(app, a.start).id } : { kind: 'token' };
    change = { addGoal: { target: shipOf(app, a.target).id, start, priority: a.priority, mode: a.mode } };
  } else if (kind === 'remove_goal') change = { removeGoal: goalOf(app, args.remove_goal).id };
  else if (kind === 'buy') {
    const b = args.buy;
    const copies = b.copies ?? 1;
    if (copies > MAX_COPIES) throw new ToolError(`At most ${MAX_COPIES} copies per what-if.`);
    change = { buy: { from: shipOf(app, b.from).id, to: shipOf(app, b.to).id, kind: b.kind ?? 'warbond', cash: toCents(b.price), copies } };
    // A purchase the store could not make (same ship, target not dearer): say so instead of planning it.
    try { assertBuyable(change.buy.from, change.buy.to, app.data); } catch (e) { throw new ToolError(`${e.message}.`); }
  } else change = { price: { shipId: shipOf(app, args.price.ship).id, msrp: toCents(args.price.price) } };
  if (ctx.signal?.aborted) throw new ToolError('Cancelled.');
  const before = summarize(sessionOf(app)); // planning cost: one full plan, then one for the edited state
  if (ctx.signal?.aborted) throw new ToolError('Cancelled.');
  const r = whatIf(app, change, { before });
  const d = r.grand.delta;
  let text;
  if (kind === 'add_goal') text = addGoalText(r);
  else if (kind === 'remove_goal') text = removeGoalText(r);
  else if (kind === 'buy') text = buyRowText({ copies: r.purchase.copies, spent: r.purchase.spent, saved: 0 - r.totalDelta, net: r.net, usedCopies: r.usedCopies, deltas: r.deltas });
  else {
    const s = app.data.ships.get(change.price.shipId);
    text = `If ${s.name} cost ${usd(change.price.msrp)} (RSI: ${usd(s.msrp)}): ${otherGoalsText(r).replace('Other goals', 'Goals')} Total ${signed(r.totalDelta)}.`;
  }
  text = `${text}\n(What-if only: nothing was saved.)`;
  const goalsOf = (side) => Object.entries(side.goals).map(([id, x]) => ({ id, name: x.name, cash: x.cash }));
  return {
    text,
    data: {
      change: kind, totalDelta: r.totalDelta, grandDelta: d, before: { total: r.before.total, goals: goalsOf(r.before) }, after: { total: r.after.total, goals: goalsOf(r.after) },
      deltas: r.deltas, added: r.added, removed: r.removed,
      ...(r.purchase ? { purchase: r.purchase, usedCopies: r.usedCopies, net: r.net } : {}),
    },
  };
}

function checkOfferTool(deps, args) {
  const app = deps.load();
  const ships = app.data.ships;
  let offers;
  const notes = [];
  if (args.text != null) {
    const p = parseOfferText(args.text, ships);
    offers = p.offers;
    for (const u of p.unmatched) notes.push(`Could not read "${u.line}": ${u.reason}`);
    for (const o of p.offers) if (o.kindAssumed) notes.push(`${pair(app, o.from, o.to)}: assumed Warbond (the text did not say).`);
    if (!offers.length) throw new ToolError(`No offer found in the text.${notes.length ? ` ${notes.join(' ')}` : ''}`);
  } else {
    if (args.from == null || args.to == null || args.price == null) throw new ToolError('Give from, to and price, or free text in `text`.');
    offers = [{ from: shipOf(app, args.from).id, to: shipOf(app, args.to).id, cash: toCents(args.price), kind: args.kind ?? 'warbond' }];
  }
  if (offers.length > MAX_OFFERS) {
    notes.push(`Only the first ${MAX_OFFERS} of ${offers.length} offers were checked.`);
    offers = offers.slice(0, MAX_OFFERS);
  }
  const before = summarize(sessionOf(app));
  const blocks = [];
  const results = [];
  for (const o of offers) {
    const r = checkOffer(app, { from: o.from, to: o.to, kind: o.kind, cash: o.cash, before });
    blocks.push([`${pair(app, o.from, o.to)} ${kindWord(o.kind)} ${usd(o.cash)}: ${r.verdict}`, ...offerCheckLines(r, nameOf(app)).map((l) => `  ${l}`)].join('\n'));
    results.push({
      ...pairData(app, o.from, o.to), kind: o.kind, cash: o.cash, verdict: r.verdict, saving: r.saving, store: r.store,
      copies: r.copies.map((c) => ({ paid: c.paid, giftable: c.giftable, usedBy: c.usedBy?.goalName ?? null })), onRoutes: r.onRoutes.map((x) => x.goalName),
    });
  }
  return { text: [...blocks, ...notes].join('\n\n'), data: { offers: results, notes } };
}

function compareCcugameTool(deps, args) {
  const app = deps.load();
  const p = String(args.path ?? '');
  if (!isAbsolute(p) || !/\.json$/i.test(p)) throw new ToolError('Give the absolute path of a CCU Game Saved Chains .json file.');
  let text;
  try {
    text = deps.readFile(p, MAX_FILE_BYTES);
  } catch {
    throw new ToolError('Could not read that file.');
  }
  let r;
  try {
    r = compareCcuGame(app, text, { aliases: deps.aliases ?? null });
  } catch {
    throw new ToolError('This is not a CCU Game saved-chains file.');
  }
  const lines = [];
  for (const row of r.rows) {
    const head = `${row.name}: CCU Game ${usd(row.ccugameCashNoStart)}${row.goalId ? ` vs planner ${usd(row.ourCash)}${row.diff != null ? ` (${signed(row.diff)})` : ''}` : ', no matching goal'}`;
    lines.push(`- ${head}${row.notes.length ? `\n    ${row.notes.join('\n    ')}` : ''}`);
  }
  for (const o of r.onlyOurs) lines.push(`- ${o.note}`);
  lines.push('', `Matched ${r.totals.matched}: CCU Game ${usd(r.totals.ccugame)}, planner ${usd(r.totals.ours)} (${signed(r.totals.diff)}).`, ...r.notes);
  return { text: lines.join('\n'), data: r };
}

function hangarCcusInto(deps, args) {
  const app = deps.load();
  const ship = shipOf(app, args.ship);
  const r = ownedInto(app, ship.id, { day: dayOf(deps) });
  if (!r.total) return { text: `You own no CCU into ${ship.name}.`, data: { ship: ship.name, shipId: ship.id, total: 0, groups: [] } };
  const lines = [`You own ${r.total} CCU(s) into ${ship.name}:`];
  for (const g of r.groups) {
    lines.push(`- ${g.fromName} → ${ship.name} x${g.count}`);
    for (const c of g.copies) lines.push(`    ${c.paid != null ? `paid ${usd(c.paid)}` : 'paid unknown'}${c.giftable ? ', giftable' : ''}: ${c.use.text}`);
  }
  return {
    text: lines.join('\n'),
    data: { ship: ship.name, shipId: ship.id, total: r.total, groups: r.groups.map((g) => ({ from: g.from, fromName: g.fromName, count: g.count, copies: g.copies.map((c) => ({ copyId: c.copyId, paid: c.paid, giftable: c.giftable, use: c.use.kind, usedBy: c.use.goalName })) })) },
  };
}

// ----- sync tools (they only read RSI) -----

const NO_SESSION = 'No stored RSI session. Sign in once through the planner app (Sync menu) or the CLI (npm run login in the ccu-planner folder), then try again. This server never asks for or accepts a password.';
let syncing = false;
const CANCEL_WAIT_MS = 1500;

async function runSync(deps, ctx, cmd, options, label) {
  let available;
  try {
    available = await deps.sync?.available();
  } catch (e) {
    throw new ToolError(e.message);
  }
  if (!available) throw new ToolError(NO_SESSION);
  if (syncing) throw new ToolError('A sync is already running in this server.');
  syncing = true;
  // The in-process flag and the cross-process lock (taken inside deps.sync.run) are released only when the run really ends.
  const running = deps.sync.run(cmd, options, { signal: ctx.signal, onProgress: (e) => ctx.progress?.(e) });
  const settled = running.then(() => {}, () => {}).finally(() => { syncing = false; });
  const aborted = new Promise((resolve) => {
    if (ctx.signal?.aborted) resolve();
    else ctx.signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  try {
    const first = await Promise.race([running.then((r) => ({ r }), (error) => ({ error })), aborted.then(() => null)]);
    let result = first;
    if (result === null) {
      // Cancel requested: the run stops at its next check. The headless sign-in check cannot be interrupted, so do not wait for it.
      const quick = await Promise.race([running.then((r) => ({ r }), (error) => ({ error })), new Promise((res) => setTimeout(() => res(null), CANCEL_WAIT_MS))]);
      if (quick === null) throw new ToolError('Cancel requested; waiting for the sign-in check to finish. The sync stops as soon as it does, and no further requests are sent.');
      result = quick;
    }
    if (result.error) throw result.error;
    const out = result.r;
    const app = deps.load();
    return { text: `${label} finished: ${out.requests} request(s), ${out.seconds.toFixed(1)}s. ${dataAge(app, deps.now())}.`, data: { command: cmd, requests: out.requests, seconds: out.seconds, storeAt: app.data.meta?.catalogAt ?? null, hangarAt: app.data.meta?.hangarAt ?? null } };
  } catch (e) {
    if (e instanceof ToolError) throw e;
    if (e.busy || e.clear) throw new ToolError(e.message);
    if (/session missing or expired|NeedLogin/i.test(e.message)) throw new ToolError(NO_SESSION);
    if (/cancelled/i.test(e.message)) throw new ToolError(`${label} cancelled; progress saved.`);
    throw new ToolError(`${label} failed: ${e.message}`);
  } finally {
    void settled;
  }
}

const syncHangar = (deps, args, ctx = {}) => runSync(deps, ctx, 'hangar', { full: !!args.full }, 'Hangar sync');
const syncStore = (deps, args, ctx = {}) => runSync(deps, ctx, 'upgrades', { full: !!args.full }, 'Store sync');

// ----- write tools (only with --allow-writes): each saves through the revisioned save the app uses -----

function commit(deps, app, action, ctx = {}) {
  if (deps.allowWrites !== true) throw new ToolError('Plan changes are off: the server was not started with --allow-writes.');
  const meta = { catalogAt: app.data.meta?.catalogAt ?? null, hangarAt: app.data.meta?.hangarAt ?? null };
  let out;
  try {
    out = applyAction({ plans: app.plans, overrides: app.overrides, saleEvents: userSaleEvents(app.saleEvents) }, action, { ships: app.data.ships, graph: app.graph, meta, ...ctx });
  } catch (e) {
    throw new ToolError(e.message);
  }
  const name = out.changed;
  if (!deps.save(DOC_NAMES[name], out[name])) {
    throw new ToolError(`The ${DOC_NAMES[name]} changed on disk since they were read (another app or session saved first). Nothing was written; run the tool again.`);
  }
  return out;
}

function addGoal(deps, args) {
  const app = deps.load();
  const target = shipOf(app, args.target);
  const start = args.start != null ? { kind: 'ship', ship: shipOf(app, args.start).id } : { kind: 'token' };
  const out = commit(deps, app, { type: 'addChain', start, target: target.id, priority: args.priority, mode: args.mode });
  return { text: `Goal added: ${target.name} [${out.result.id}], ${args.priority ?? 'normal'} priority, ${start.kind === 'token' ? 'starting from any LTI token' : `starting from ${shipOf(app, args.start).name}`}.`, data: { id: out.result.id, name: target.name } };
}

function removeGoal(deps, args) {
  const app = deps.load();
  const c = goalOf(app, args.goal);
  commit(deps, app, { type: 'remove', chainId: c.id });
  return { text: `Goal removed: ${goalLabel(c, app.data.ships)} [${c.id}].`, data: { id: c.id } };
}

function accept(deps, args) {
  const app = deps.load();
  const c = goalOf(app, args.goal);
  const route = sessionOf(app).route(c.id);
  if (!route) throw new ToolError(`${goalLabel(c, app.data.ships)} has no route today, so there is nothing to reserve.`);
  const out = commit(deps, app, { type: 'accept', chainId: c.id, route });
  return { text: `Reserved the current best chain of ${goalLabel(c, app.data.ships)}: ${usd(route.cash)} new money, ${route.steps.length} step(s). Its owned CCUs are now held for this goal.`, data: { id: c.id, rev: out.result.rev, cash: route.cash } };
}

function setLockTool(value) {
  return (deps, args) => {
    const app = deps.load();
    const c = goalOf(app, args.goal);
    const v = value ?? args.setting ?? 'on';
    commit(deps, app, { type: 'setLock', chainId: c.id, value: v });
    const word = { on: 'always lock the price (buy the last step now)', off: 'never lock the price', auto: 'lock the price when it makes sense' }[v];
    return { text: `${goalLabel(c, app.data.ships)}: ${word}.`, data: { id: c.id, lock: v } };
  };
}

function setCredit(deps, args) {
  const app = deps.load();
  const cents = toCents(args.dollars);
  if (args.dollars < 0) throw new ToolError('Credit cannot be negative.');
  commit(deps, app, { type: 'setCredit', cents });
  return { text: `Store credit set to ${usd(cents)}.`, data: { cents } };
}

function priceOverride(deps, args) {
  const app = deps.load();
  const ship = shipOf(app, args.ship);
  if (args.clear) {
    commit(deps, app, { type: 'clearPrice', shipId: ship.id });
    return { text: `${ship.name}: back to the RSI price ${usd(ship.msrp)}.`, data: { shipId: ship.id, cleared: true } };
  }
  if (args.price == null) throw new ToolError('Give price (dollars), or clear: true.');
  const cents = toCents(args.price);
  commit(deps, app, { type: 'setPrice', shipId: ship.id, cents, note: args.note });
  return { text: `${ship.name}: expected price ${usd(cents)} (RSI today ${usd(ship.msrp)}).`, data: { shipId: ship.id, cents } };
}

// ----- the table -----

const object = (shape) => z.object(shape);
const priority = z.enum(['high', 'normal', 'low']).optional();
const mode = z.enum(['watch', 'finish']).optional().describe('watch: wait for sales when it saves money; finish: get it as soon as possible');
const buyKind = z.enum(['warbond', 'standard']).optional().describe('Default warbond');

const DEFINITIONS = [
  { name: 'today', group: 'read', description: 'What to buy today across all goals: buy now, on sale (no rush), optional, with counts, prices and payment (store credit works for Standard only). Same answer as the Today page.', schema: object({}), handler: today },
  { name: 'goals', group: 'read', description: 'All goals with status, cost in new money (alone vs shared with the other goals) and counts of steps to buy or wait for.', schema: object({}), handler: goals },
  { name: 'goal', group: 'read', description: 'One goal: its route step by step with the reason for each step (own, buy now, wait), cost alone vs shared, and what other goals hold that it would use.', schema: object({ goal: goalArg }), handler: goal },
  { name: 'changes_since_sync', group: 'read', description: 'How the plan cost changed since the last sync with different data, per goal with the causes (price moved, offer gone, CCU taken by another goal).', schema: object({}), handler: changesSinceSyncTool },
  {
    name: 'what_if', group: 'read', description: 'Plan again in memory with one change and compare with now. Nothing is saved. Give exactly one of: add_goal, remove_goal, buy (N copies of an upgrade at a price), price (a ship at a new price).',
    schema: object({
      add_goal: object({ target: shipArg, start: shipArg.optional().describe('Fixed start ship; default any LTI token'), priority, mode }).optional(),
      remove_goal: goalArg.optional(),
      buy: object({ from: shipArg, to: shipArg, price: dollars('Price of one copy'), kind: buyKind, copies: z.number().int().min(1).max(MAX_COPIES).optional().describe('Default 1') }).optional(),
      price: object({ ship: shipArg, price: dollars('New ship price') }).optional(),
    }), handler: whatIfTool,
  },
  {
    name: 'check_offer', group: 'read', description: 'What a CCU offer means for your goals: do you own copies, which routes use the pair, what buying one saves, with a verdict. Give from, to and price, or paste offer text (e.g. a CCU Game post) in `text`.',
    schema: object({ from: shipArg.optional(), to: shipArg.optional(), price: dollars('Offer price').optional(), kind: buyKind, text: z.string().max(20000).optional().describe('Free text with one offer per line, e.g. "Pulse → Orion $150"') }), handler: checkOfferTool,
  },
  { name: 'compare_ccugame', group: 'read', description: 'Compare your goals with a CCU Game Saved Chains export (reads only that one .json file).', schema: object({ path: z.string().max(1024).describe('Absolute path to the Saved Chains .json file (not inside the planner data folder)') }), handler: compareCcugameTool },
  { name: 'hangar_ccus_into', group: 'read', description: 'The CCUs you own into a ship, grouped by source ship, and what each copy is used for.', schema: object({ ship: shipArg }), handler: hangarCcusInto },
  { name: 'sync_hangar', group: 'sync', description: 'Read your hangar from RSI (read-only requests) and update the local data. Needs a stored RSI session from the app or CLI.', schema: object({ full: z.boolean().optional().describe('Re-read every pledge instead of only new ones') }), handler: syncHangar },
  { name: 'sync_store', group: 'sync', description: 'Read the upgrade store from RSI (read-only requests) and update prices and offers; reports progress, can take minutes. Needs a stored RSI session from the app or CLI.', schema: object({ full: z.boolean().optional().describe('Start over instead of resuming an interrupted sync') }), handler: syncStore },
  { name: 'add_goal', group: 'write', description: 'Add a goal (target ship). Writes the plans file.', schema: object({ target: shipArg, start: shipArg.optional().describe('Fixed start ship; default any LTI token'), priority, mode }), handler: addGoal },
  { name: 'remove_goal', group: 'write', description: 'Remove a goal. Writes the plans file.', schema: object({ goal: goalArg }), handler: removeGoal },
  { name: 'accept', group: 'write', description: "Reserve a goal's current best chain, which holds its owned CCUs for that goal (the tool keeps its old name, accept, for compatibility). Writes the plans file.", schema: object({ goal: goalArg }), handler: accept },
  { name: 'lock', group: 'write', description: "Set a goal to lock today's price (buy the last step now). Writes the plans file.", schema: object({ goal: goalArg, setting: z.enum(['on', 'auto']).optional().describe('on (default) or auto') }), handler: setLockTool(null) },
  { name: 'unlock', group: 'write', description: "Set a goal to never lock the price (the app's \"Don't lock this goal\"). Writes the plans file.", schema: object({ goal: goalArg }), handler: setLockTool('off') },
  { name: 'set_credit', group: 'write', description: 'Set your store credit. Writes the plans file.', schema: object({ dollars: z.number().min(0).max(MAX_DOLLARS).describe('Store credit in US dollars') }), handler: setCredit },
  { name: 'price_override', group: 'write', description: 'Set or clear your expected price for a ship (an announced price rise). Writes the price-overrides file, never the synced catalog.', schema: object({ ship: shipArg, price: dollars('Expected price').optional(), clear: z.boolean().optional(), note: z.string().max(200).optional() }), handler: priceOverride },
];

/** The same tools with an async handler (a sync throw becomes a rejection); `raw` is the plain function. */
export const TOOLS = DEFINITIONS.map((t) => ({ ...t, raw: t.handler, handler: async (deps, args, ctx) => t.handler(deps, args, ctx) }));

/** The tools to register: read-only and sync always, the write tools only with allowWrites. */
export const toolsFor = ({ allowWrites = false } = {}) => TOOLS.filter((t) => t.group !== 'write' || allowWrites);
