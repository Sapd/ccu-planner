// What-if: plan again on edited documents held in memory, never saved. Pure: no I/O, no Svelte; the input app is never
// changed (the edited copies are new objects). The result is plain data, so the app, the CLI and the MCP tools all
// use it.
//
//   whatIf(app, change)        one change, before and after for every goal
//   buyEffect(app, buy)        buying 1, 2, ... copies of one upgrade: what each extra copy saves
//
// `app` is { plans, graph, data?, overrides?, saleEvents?, expected?, session? } like sessionOf() takes.
// The planning of an edited state costs as much as a whole plan (seconds on a large account): the app runs it in a
// worker (see jobs.mjs).
import { applyAction } from './state.mjs';
import { createSession, sessionFor } from './session.mjs';
import { buildGraph, keepVirtual } from './planner.mjs';
import { expectedOffers } from './prices.mjs';
import { goalLabel } from './ships.mjs';

/** Copy ids of hypothetical copies start with this prefix (see `usedCopies`). */
export const WHATIF_COPY = 'whatif:';


// Owned copies and store offers of a graph, to rebuild it with changes. Works for an app without `data.offers`.
function graphParts(graph) {
  const owned = [];
  const offers = [];
  for (const edges of graph.edges.values()) {
    for (const e of edges) {
      if (e.kind === 'owned') for (const c of e.copies) owned.push({ ...c, from: e.from, to: e.to });
      else if (!e.virtual) offers.push(e);
    }
  }
  return { owned, offers };
}

const rebuild = (graph, { owned, offers, ships }) => keepVirtual(graph, { ...buildGraph({ offers, owned, lti: graph.lti, ships }), concept: graph.concept });

// One session for edited documents: everything else comes from `app`.
function editedSession(app, { plans = app.plans, graph = app.graph, data = app.data ?? null }) {
  return createSession({ plans, graph, data, overrides: app.overrides ?? null, saleEvents: app.saleEvents ?? null, expected: app.expected ?? null, maxSteps: app.session?.maxSteps ?? app.maxSteps ?? 25 });
}

/**
 * Throws when a CCU from `from` to `to` is something the store could not sell: the same ship twice, a ship that is not in the
 * catalog, or a target that does not cost more than the source. Guards hypothetical purchases only; a downward CCU you already own
 * stays usable in planning. Does nothing without a catalog, and a ship without a price is not judged.
 */
export function assertBuyable(from, to, data) {
  const catalog = data?.ships;
  if (!catalog) return;
  for (const id of [from, to]) if (!catalog.has(id)) throw new Error(`unknown ship ${id}`);
  if (from === to) throw new Error(`${catalog.get(to).name} to itself is not an upgrade RSI sells`);
  const [a, b] = [catalog.get(from).msrp, catalog.get(to).msrp];
  if (a != null && b != null && !(b > a)) throw new Error(`${catalog.get(to).name} does not cost more than ${catalog.get(from).name}, so RSI sells no upgrade from one to the other`);
}

/** { total, goals: { [id]: { name, cash } } } of a session's shared plan; cash null = no route. total adds every goal that has one. */
export function summarize(session) {
  const { plans, data } = session;
  const goals = {};
  let total = 0;
  for (const [id, entry] of session.shared) {
    const cash = entry.route?.cash ?? null;
    goals[id] = { name: goalLabel(plans.chains[id], data?.ships), cash };
    total += cash ?? 0;
  }
  return { total, goals };
}

const sumOver = (goals, ids) => ids.reduce((n, id) => n + (goals[id].cash ?? 0), 0);

// The edited session for one change, plus what the change adds to the result.
function applyChange(app, change) {
  const ctx = { ships: app.data?.ships };
  const docs = { plans: app.plans, overrides: app.overrides ?? { rev: 0, ships: {} }, saleEvents: app.saleEvents };
  if ('addGoal' in change) {
    const g = change.addGoal;
    const start = g.start ?? { kind: 'token' };
    const out = applyAction(docs, { type: 'addChain', start, target: g.target, priority: g.priority, mode: g.mode ?? 'watch' }, ctx);
    if (g.objective) out.plans.chains[out.result.id].objective = g.objective;
    return { session: editedSession(app, { plans: out.plans }), newId: out.result.id };
  }
  if ('removeGoal' in change) {
    const out = applyAction(docs, { type: 'remove', chainId: change.removeGoal }, ctx);
    return { session: editedSession(app, { plans: out.plans }) };
  }
  if ('priority' in change) {
    const out = applyAction(docs, { type: 'setPriority', chainId: change.priority.id, value: change.priority.priority }, ctx);
    return { session: editedSession(app, { plans: out.plans }) };
  }
  if ('buy' in change) {
    const b = change.buy;
    assertBuyable(b.from, b.to, app.data);
    const copies = Math.max(0, Math.floor(b.copies ?? 1));
    const { owned, offers } = graphParts(app.graph);
    const ships = app.data?.ships ?? new Map();
    const added = Array.from({ length: copies }, (_, i) => ({
      copyId: `${WHATIF_COPY}${b.from}-${b.to}-${i + 1}`, from: b.from, to: b.to, name: `${b.kind === 'standard' ? 'Standard' : 'Warbond'} (what if)`,
      edition: b.kind === 'standard' ? 'Standard' : 'Warbond', paid: { cents: b.cash, currency: 'USD' }, giftable: false, meltable: true, extras: [],
    }));
    const graph = rebuild(app.graph, { owned: [...owned, ...added], offers, ships });
    return { session: editedSession(app, { graph, data: app.data ? { ...app.data, owned: [...(app.data.owned ?? []), ...added] } : null }), spent: b.cash * copies };
  }
  if ('price' in change) {
    const { shipId, msrp } = change.price;
    if (!app.data?.ships?.has(shipId)) throw new Error(`unknown ship ${shipId}`);
    if (!Number.isInteger(msrp) || msrp <= 0) throw new Error('price must be a whole number of cents above zero');
    // The same mechanism as the expected prices: Standard offers touching the ship are recomputed at the new msrp
    // difference; Warbond prices are fixed quotes and stay.
    const only = { rev: 0, ships: { [shipId]: { msrp } } };
    const { owned, offers } = graphParts(app.graph);
    const ships = new Map(app.data.ships);
    ships.set(shipId, { ...ships.get(shipId), msrp });
    const graph = rebuild(app.graph, { owned, offers: expectedOffers(offers, app.data.ships, only), ships });
    return { session: editedSession(app, { graph, data: { ...app.data, ships, offers: expectedOffers(app.data.offers ?? offers, app.data.ships, only) } }) };
  }
  throw new Error('unknown what-if change');
}

/**
 * Plans the goals again with one change and compares with the plan now. Never saves, never changes `app`.
 *
 * change: { addGoal: { target, start?, priority?, objective?, mode? } } (start default: any LTI token)
 *       | { removeGoal: goalId }
 *       | { buy: { from, to, kind: 'warbond'|'standard', cash, copies } }  as if you owned `copies` new copies of that CCU, bought for `cash` each
 *       | { price: { shipId, msrp } }  as if the ship cost `msrp` cents (Standard offers follow it, Warbonds stay)
 *       | { priority: { id, priority: 'high'|'normal'|'low' } }
 *
 * @returns {{
 *   change: object,
 *   before: { total: number, goals: Record<string, { name: string, cash: number|null }> },
 *   after: { total: number, goals: Record<string, { name: string, cash: number|null }> },
 *   deltas: Array<{ id: string, name: string, was: number|null, now: number|null, delta: number|null }>,
 *   added: Array<{ id: string, name: string, cash: number|null }>, removed: Array<{ id: string, name: string, cash: number|null }>,
 *   totalDelta: number, grand: { before: number, after: number, delta: number },
 *   purchase?: { from, to, kind, copies: number, each: number, spent: number }, usedCopies?: number, net?: number,
 * }}
 * before.goals / after.goals list every goal of that state; before.total / after.total, `deltas` and `totalDelta` only count the
 * goals present in both, so adding or removing a goal never moves them (added / removed list those apart, with their cash;
 * grand = every goal of each state). deltas lists the common goals whose cash differs, in planning order; delta is null when
 * one side has no route. A goal's cash is its route's new money (the cost the Today page shows), null without a route.
 * For `buy`: spent = what the copies cost, net = totalDelta + spent (negative: you end up paying less), usedCopies = how many of the
 * new copies the plan uses.
 *
 * `opts.before`: the summarize() of the plan now, when the caller already has it (the app's main thread does), so the first answer plans
 * only the edited state instead of both. It must be the summary of this `app`.
 *
 * `price` only reprices the Standard offers that exist today (an upgrade into or out of the ship that RSI sells now); it does not
 * create an upgrade RSI does not sell and it leaves Warbond quotes and owned CCUs as they are.
 */
export function whatIf(app, change, { before: known = null } = {}) {
  const before = known ?? summarize(sessionFor(app));
  const { session, newId, spent } = applyChange(app, change);
  const after = summarize(session);

  const common = Object.keys(after.goals).filter((id) => id in before.goals);
  const deltas = [];
  for (const id of common) {
    const a = before.goals[id].cash;
    const b = after.goals[id].cash;
    if (a === b) continue;
    deltas.push({ id, name: after.goals[id].name, was: a, now: b, delta: a != null && b != null ? b - a : null });
  }
  const listed = (src, ids) => ids.map((id) => ({ id, name: src.goals[id].name, cash: src.goals[id].cash }));
  const was = sumOver(before.goals, common);
  const now = sumOver(after.goals, common);
  const out = {
    change,
    before: { total: was, goals: before.goals },
    after: { total: now, goals: after.goals },
    deltas,
    added: listed(after, Object.keys(after.goals).filter((id) => !(id in before.goals))),
    removed: listed(before, Object.keys(before.goals).filter((id) => !(id in after.goals))),
    totalDelta: now - was,
    grand: { before: before.total, after: after.total, delta: after.total - before.total },
  };
  if (newId) out.newGoalId = newId;
  if (spent != null) {
    const b = change.buy;
    let used = 0;
    for (const entry of session.shared.values()) for (const s of entry.route?.steps ?? []) if (String(s.copyId ?? '').startsWith(WHATIF_COPY)) used++;
    out.purchase = { from: b.from, to: b.to, kind: b.kind, copies: Math.max(0, Math.floor(b.copies ?? 1)), each: b.cash, spent };
    out.usedCopies = used;
    // Goals whose plan today already buys this exact pair (an accepted goal's route is fixed, so an extra copy can't replace its step).
    out.plannedBy = [];
    if (used === 0) {
      for (const [id, entry] of sessionFor(app).shared) {
        if ((entry.route?.steps ?? []).some((s) => s.from === b.from && s.to === b.to && s.copyId == null)) out.plannedBy.push(goalLabel(app.plans.chains[id], app.data?.ships));
      }
    }
    out.net = out.totalDelta + spent;
  }
  return out;
}

/**
 * What buying 1, 2, ... `maxCopies` copies of one upgrade does, and what each extra copy adds.
 * @returns {{ buy: object, rows: Array<{ copies: number, spent: number, saved: number, net: number, usedCopies: number, extraSaved: number, deltas: object[] }> }}
 * saved = how much cheaper the goals get (positive; negative: dearer), net = spent - saved (negative: you come out ahead),
 * extraSaved = saved minus the saving with one copy fewer (0: that copy saves nothing).
 */
export function buyEffect(app, { from, to, kind, cash, maxCopies = 2, before = null }) {
  assertBuyable(from, to, app.data);
  const rows = [];
  let prev = 0;
  for (let copies = 1; copies <= maxCopies; copies++) {
    const r = whatIf(app, { buy: { from, to, kind, cash, copies } }, { before });
    const saved = 0 - r.totalDelta; // (0 - x, so no -0)
    rows.push({ copies, spent: r.purchase.spent, saved, net: r.net, usedCopies: r.usedCopies, plannedBy: r.plannedBy ?? [], extraSaved: saved - prev, deltas: r.deltas });
    prev = saved;
  }
  return { buy: { from, to, kind, cash }, rows };
}
