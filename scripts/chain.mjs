// Saved chains with CCU reservations.
//
//   chain add [--start token|<ship>] --to "600i Explorer" [--name X] [--priority high|normal|low]
//   chain list                      status, cash, reserved CCUs, change since reserved
//   chain show <id> [--k 3]         proposal(s) vs reserved chain
//   chain accept <id> [--route N]   reserve proposal N (default 1): holds its CCUs (the command keeps the name accept)
//   chain refresh                   re-check every chain against current data
//   chain fleet [--accept]          (--accept reserves every chain without one) plan all chains by priority (same priority: cheapest total), sharing CCUs and credit
//   chain release <id> | remove <id>
//   chain credit <usd>              store credit available for planning
//   chain mode <id> watch|finish    watch: wait for Warbonds; finish: complete now
//   chain melt [--protect id,id]    which unused CCUs to melt to cover finish chains
//   chain event | chain event add "<name>" <from> <to> | chain event rm <id>
//                                   sale events (dates YYYY-MM-DD, inclusive); upgrades bought only during one may vanish after it
//   chain avail <ship> [regular|event-only|clear]   is the ship's Standard upgrade bought outside sale events? (no value: show it)
//   chain changes                   what changed since the last sync (needs plan-snapshots.json, written by scripts/sync.mjs)
//   chain warbonds [--hours 24]     Warbonds that appeared recently and which chains use them
//   chain wanted [<id>] [--top 12] [--slack 10]   which new Warbonds would help, and below what price
//   chain lock <id> auto|on|off      buy the last step into the target now while waiting (auto: concept or expected rise)
//   chain offer <from> <to> <YYYY-MM-DD|soon|clear>   your note on how long an upgrade offer runs: until a day, ends soon, or clear it (a far day moves it to "On sale")
//   chain objective <id> cash|allin cash: least new money; allin: least new money + owned CCU value used
//   chain price <ship> <usd> [--note text] | chain price <ship> --clear | chain prices
//                                   your expected price for a ship (e.g. an announced increase)
//   --data <dir>                    any command: use this data directory for the run (same as CCU_DATA)

import fs from 'node:fs';
import path from 'node:path';
import { meltPlan } from '../src/logic/melt.mjs';
import { availCtx, localToday, shipAvailability } from '../src/logic/availability.mjs';
import { hasPriceOverrides } from '../src/logic/prices.mjs';
import { buildGraph } from '../src/logic/planner.mjs';
import { goalNamer } from '../src/logic/ships.mjs';
import { createSession } from '../src/logic/session.mjs';
import { routeAdvice } from '../src/logic/advice.mjs';
import { groupWanted } from '../src/logic/wantedView.mjs';
import { changesSinceSync } from '../src/logic/changes.mjs';
import { parseHistory, eventsSince, recentWarbondEvents } from '../src/logic/warbonds.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { usd, currencyProblem } from '../src/logic/format.mjs';
import { NO_TOKEN_TEXT, sharedEffectLine, issueLine, routeLine, describeDiff, meltHeadline, meltWithoutNote, MELT_IDLE, MELT_NOTE, meltPlanLines, meltPickLine, changesHeadline, changesGoalLines, goalChangeLine, priceLine, buyGroupLines, buyBeforeText, availabilityText, noEventsNotice } from '../src/logic/describe.mjs';
import {
  evaluateAccepted, diffRoutes, reservations, creditCommitted,
  ConflictError, startOf, recordSeen, lockReason,
} from '../src/logic/chains.mjs';

// --data <dir> sets the data directory for this run, like CCU_DATA. It is taken
// out of the arguments and must be set before src/data.mjs is imported: that
// module reads CCU_DATA once, when it loads.
const argv = process.argv.slice(2);
const dataAt = argv.indexOf('--data');
if (dataAt >= 0) {
  const dir = argv[dataAt + 1];
  if (!dir || dir.startsWith('--')) { console.error('usage: --data <dir>'); process.exit(2); }
  process.env.CCU_DATA = dir;
  argv.splice(dataAt, 2);
}
const {
  DATA_DIR, loadPlannerData, loadSnapshots, findShip, loadPlans, savePlans, loadOverrides, saveOverrides, loadSaleEvents, saveSaleEvents, expectedOffers,
} = await import('../src/data.mjs');
const { mergeSaleEvents } = await import('../src/logic/feed.mjs');
const { loadFeedEvents } = await import('../src/feed.mjs');

const args = argv;
const [cmd, id] = args;
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);

const data = loadPlannerData();
const wrongCurrency = currencyProblem(data.pricing);
if (wrongCurrency) { console.error(wrongCurrency); process.exit(1); }
let state = loadPlans();
const { ships } = data;
const graph = buildGraph(data);
const name = (shipId) => ships.get(shipId)?.name ?? `#${shipId}`;
const goalName = (gid) => goalNamer(state, ships)(gid);
const meta = { catalogAt: data.meta.catalogAt, hangarAt: data.meta.hangarAt };
const getChain = (cid) => state.chains[cid] ?? (console.error(`unknown chain ${cid}`), process.exit(2));
let overrides = loadOverrides();
const expected = expectedOffers(data.offers, ships, overrides);
const hasOverrides = hasPriceOverrides(overrides);
let saleEvents = loadSaleEvents(); // yours: the only part that is saved
// Plus the events of the signed feed's saved copy (refresh it with `npm run feed`); the planner uses both.
const feedPart = loadFeedEvents(DATA_DIR);
let mergedFor = null, merged = null;
const planning = () => (mergedFor === saleEvents ? merged : (mergedFor = saleEvents, merged = mergeSaleEvents(saleEvents, feedPart.events, feedPart.at)));
const today = localToday();
// Availability inputs as of now (overrides and events change when a command edits them).
const avail = () => availCtx({ data, saleEvents: planning(), overrides }, today);
// One planning session per set of documents: everything derived from them is computed once. A command
// that changes a document (see run) gets a new one.
let session = null;
const sess = () => (session?.plans === state && session.overrides === overrides && session.saleEvents === planning() ? session : (session = createSession({ plans: state, graph, data, overrides, saleEvents: planning(), expected })));

// Every change goes through applyAction. Nothing is written until save(): each
// document keeps the rev it was loaded at, and save() refuses if the file on
// disk has moved on since, then writes rev + 1.
function run(action) {
  let out;
  try {
    out = applyAction({ plans: state, overrides, saleEvents }, action, { ships, meta });
  } catch (e) {
    if (e instanceof ConflictError) { console.error(`conflict: ${e.message}`); process.exit(3); }
    throw e;
  }
  state = out.plans;
  overrides = out.overrides;
  saleEvents = out.saleEvents;
  save(out.changed);
  return out.result;
}

function save(which) {
  const ok = which === 'plans' ? savePlans(state) : which === 'saleEvents' ? saveSaleEvents(saleEvents) : saveOverrides(overrides);
  if (!ok) {
    console.error(`${{ plans: 'plans.json', saleEvents: 'sale-events.json', overrides: 'price-overrides.json' }[which]} changed while this command ran; nothing saved. Run the command again.`);
    process.exit(3);
  }
}

// What to do with a goal's route (lock, split, alerts): one routeAdvice, formatted here.
const adviceFor = (chain, route) => sess().advice(chain.id, { route, day: today });

function printAlerts(adv, indent = '    ') {
  for (const a of adv.alerts) console.log(`${indent}! ${buyBeforeText(a, { name, arrow: '->', hint: '; set one with chain price' })}`);
  for (const a of adv.cheaper) console.log(`${indent}  cheaper after the price change: ${name(a.step.from)} -> ${name(a.step.to)} ${usd(a.now)} -> ${usd(a.expected)}`);
}

function printRoute(r, indent = '    ') {
  for (const s of r.steps) {
    const what = s.kind === 'owned'
      ? `OWNED  CCU${s.otherCopies ? ` (+${s.otherCopies} more copies)` : ''}`
      : `${s.kind === 'warbond' ? 'BUY WB' : 'BUY   '} ${usd(s.cash)}`;
    console.log(`${indent}${name(s.from)} -> ${name(s.to)}: ${what}`);
  }
}

switch (cmd) {
  case 'add': {
    const target = findShip(ships, opt('to'));
    const given = (n) => { const v = opt(n); return v === undefined || v.startsWith('--') ? undefined : v; };
    const useStart = flag('start');
    const startArg = useStart ? given('start') : flag('from') ? given('from') : 'token';
    const fixed = startArg === undefined || startArg === 'token' ? null : findShip(ships, startArg);
    if (!target || (!useStart && startArg === undefined) || (!useStart && startArg !== 'token' && !fixed)) { console.error('unknown ship for --from/--to'); process.exit(2); }
    if (useStart && startArg !== 'token' && !fixed) { console.error(`unknown start ship${startArg ? ` ${startArg}` : ''} (use token or a ship name)`); process.exit(2); }
    const start = fixed ? { kind: 'ship', ship: fixed.id } : { kind: 'token' };
    const c = run({ type: 'addChain', name: opt('name', fixed ? `${fixed.name} -> ${target.name}` : undefined), start, target: target.id, priority: opt('priority', 'normal'), mode: opt('mode', 'watch') });
    console.log(`added ${c.id}: ${c.name} (${c.priority}, ${c.mode}). Next: chain show ${c.id}`);
    break;
  }
  case 'credit': {
    const cents = Math.round(Number(id) * 100);
    if (!Number.isFinite(cents) || cents < 0) { console.error('usage: chain credit <usd>'); process.exit(2); }
    run({ type: 'setCredit', cents });
    console.log(`store credit for planning: ${usd(state.profile.credit)} (committed: ${usd(creditCommitted(state))})`);
    break;
  }
  case 'list':
  case 'refresh': {
    const res = reservations(state);
    console.log(`credit ${usd(state.profile.credit)} (${usd(creditCommitted(state))} committed) · ${res.size} CCUs reserved · store ${meta.catalogAt?.slice(0, 16)} · hangar ${meta.hangarAt?.slice(0, 16)}`);
    for (const c of Object.values(state.chains)) {
      const mode = c.mode ?? 'watch';
      const ev = evaluateAccepted(state, c.id, data);
      const prop = sess().proposal(c.id, 1);
      const best = prop.routes[0] ?? null;
      const d = diffRoutes(c.accepted, best);
      const now = c.accepted ? `${ev.status.toUpperCase()} ${usd(ev.cash)} cash` : 'DRAFT';
      console.log(`\n${c.id} [${c.priority}, ${mode}, ${c.objective ?? 'cash'}] ${c.name}: ${now}${c.accepted ? ` · rev ${c.accepted.rev}` : ''}`);
      for (const i of ev.issues) console.log(`    ! ${issueLine(i, { name, goalName, arrow: '->' })}`);
      const st = startOf(c);
      console.log(`    start: ${st.kind === 'ship' ? `${name(st.ship)} (fixed)` : st.pledgeId ? (() => { const t = data.lti?.find((x) => x.pledgeId === st.pledgeId); return t ? `LTI token ${name(t.ship)} (pledge ${st.pledgeId})` : `LTI token (pledge ${st.pledgeId}, not in hangar)`; })() : 'any LTI token'}`);
      if (best) {
        if (st.kind === 'token' && best.start) console.log(`    planned start: ${name(best.start.ship)}${best.start.token ? ` (pledge ${best.start.token.pledgeId})` : ''}`);
        console.log(`    proposal: ${routeLine(best)} -> ${describeDiff(d)}`);
        const adv = adviceFor(c, best);
        for (const line of buyGroupLines(adv.buys, { name })) console.log(`    ${line}`);
        if (mode === 'watch') {
          const dec = adv.dec;
          const why = dec.reason;
          const sp = adv.split;
          const later = hasOverrides ? adv.laterExpected : sp.standardLater;
          console.log(`    waiting: later ${usd(sp.standardLater)} Standard${later !== sp.standardLater ? ` (${usd(later)} at your expected prices)` : ''} (${sp.later.length} bridge(s) a future Warbond could replace)`);
          if (why) {
            const because = why === 'expected' ? `you expect ${usd(overrides.ships[c.target].msrp)}` : why === 'on' ? 'lock on' : why === 'event' ? `${shipAvailability(avail(), c.target).event.name} is on and ${name(c.target)} is not known to stay on sale after it` : 'concept ship, price rises before release';
            if (dec.covered) console.log(`    ${adv.coverText}`);
            else if (sp.lockNow.length) console.log(`    lock now: ${name(sp.lockNow[0].from)} -> ${name(c.target)} ${usd(sp.lockCash)} Standard (store credit can pay it; ${because})`);
            else if (sp.lockedBy) console.log(`    target locked: ${sp.lockedBy.kind === 'owned' ? `owned CCU` : `Warbond ${usd(sp.lockedBy.cash)} in buy now`} into ${name(c.target)} (${because})`);
          }
        }
        printAlerts(adv);
      } else console.log(`    proposal: ${prop.noToken ? NO_TOKEN_TEXT : 'no route with the CCUs and offers left'}`);
      const share = sharedEffectLine(sess().sharedEffect(c.id), { name, arrow: '->' });
      if (share) console.log(`    ${share}`);
      if (cmd === 'refresh') {
        const ch = recordSeen(state, c.id, best);
        if (ch.kind === 'first') console.log('    (first refresh, baseline saved)');
        else if (ch.kind === 'unchanged') console.log(`    no change since ${ch.since.slice(0, 16)}`);
        else {
          const delta = ch.cashBefore != null && ch.cashAfter != null ? ch.cashAfter - ch.cashBefore : null;
          console.log(`    CHANGED since ${ch.since.slice(0, 16)}: ${usd(ch.cashBefore)} -> ${usd(ch.cashAfter)}${delta ? ` (${delta < 0 ? usd(-delta) + ' less' : usd(delta) + ' more'})` : ''}${ch.newWarbonds.length ? ` · new Warbond(s): ${ch.newWarbonds.map((s) => `${name(s.from)} -> ${name(s.to)} ${usd(s.cash)}`).join(', ')}` : ''}`);
        }
      }
    }
    if (cmd === 'refresh') save('plans');
    break;
  }
  case 'mode': {
    run({ type: 'setMode', chainId: getChain(id).id, value: args[2] });
    console.log(`${id} is now ${args[2]}`);
    break;
  }
  case 'lock': {
    run({ type: 'setLock', chainId: getChain(id).id, value: args[2] });
    // The same lock decision every page uses; a goal without a route has none, so its lock reason alone says it.
    const adv = sess().advice(id, { day: today });
    const why = adv ? adv.dec.reason : lockReason(state.chains[id], ships, overrides, avail());
    console.log(`${id} lock ${args[2]}: ${why ? 'buys its last step into the target now while waiting' : 'keeps its last step for later'}`);
    break;
  }
  case 'objective': {
    run({ type: 'setObjective', chainId: getChain(id).id, value: args[2] });
    console.log(`${id} now optimizes ${args[2] === 'allin' ? 'new money + value of the owned CCUs it uses' : 'new money'}`);
    break;
  }
  case 'price': {
    const ship = findShip(ships, id);
    if (!ship) { console.error(`unknown ship ${id}`); process.exit(2); }
    if (flag('clear')) run({ type: 'clearPrice', shipId: ship.id });
    else {
      const cents = Math.round(Number(args[2]) * 100);
      if (!Number.isFinite(cents) || cents <= 0) { console.error('usage: chain price <ship> <usd> [--note text]'); process.exit(2); }
      run({ type: 'setPrice', shipId: ship.id, cents, note: opt('note', null) });
    }
    console.log(flag('clear') ? `${ship.name}: back to the RSI price ${usd(ship.msrp)}` : `${ship.name}: expected ${usd(overrides.ships[ship.id].msrp)} (RSI today ${usd(ship.msrp)})`);
    break;
  }
  case 'prices': {
    if (!hasOverrides) console.log('No expected prices set. Use: chain price <ship> <usd>');
    for (const [sid, o] of Object.entries(overrides.ships)) {
      if (o.msrp == null) continue;
      const s = ships.get(Number(sid));
      const changed = expected.filter((e) => e.assumed && (e.from === Number(sid) || e.to === Number(sid))).length;
      console.log(priceLine(name(Number(sid)), s?.msrp, o, changed));
    }
    for (const e of planning().events) console.log(`sale event ${e.id}: ${e.name} ${e.from} to ${e.to}${e.source === 'feed' ? ' (from the feed)' : ''}`);
    for (const [sid, o] of Object.entries(overrides.ships)) {
      if (o.availability) console.log(`${name(Number(sid))}: ${availabilityText(shipAvailability(avail(), Number(sid)))}`);
    }
    break;
  }
  case 'event': {
    if (id === 'add') {
      const [, , evName, from, to] = args;
      const ev = (() => { try { return run({ type: 'setSaleEvent', name: evName, from, to }); } catch (e) { console.error(`${e.message}\nusage: chain event add "<name>" <from YYYY-MM-DD> <to YYYY-MM-DD>`); process.exit(2); } })();
      console.log(`sale event ${ev.id}: ${ev.name} ${ev.from} to ${ev.to}`);
    } else if (id === 'rm') {
      try { run({ type: 'removeSaleEvent', id: args[2] }); } catch (e) { console.error(e.message); process.exit(2); }
      console.log(`removed sale event ${args[2]}`);
    } else if (id === undefined) {
      if (!planning().events.length) console.log('No sale events set. Use: chain event add "<name>" <from> <to>');
      for (const e of planning().events) console.log(`${e.id}: ${e.name} ${e.from} to ${e.to}${e.source === 'feed' ? ' (from the feed)' : ''}${e.from <= today && today <= e.to ? ' (ongoing)' : ''}`);
    } else { console.error('usage: chain event [add "<name>" <from> <to> | rm <id>]'); process.exit(2); }
    break;
  }
  case 'offer': {
    const from = findShip(ships, id);
    const to = findShip(ships, args[2]);
    const value = args[3];
    if (!from || !to || !value) { console.error('usage: chain offer <from> <to> <YYYY-MM-DD|soon|clear>'); process.exit(2); }
    try {
      run(value === 'clear' ? { type: 'clearOfferEnd', from: from.id, to: to.id } : value === 'soon' ? { type: 'setOfferEnd', from: from.id, to: to.id, soon: true } : { type: 'setOfferEnd', from: from.id, to: to.id, until: value });
    } catch (e) { console.error(`${e.message}\nusage: chain offer <from> <to> <YYYY-MM-DD|soon|clear>`); process.exit(2); }
    const note = overrides.pairs?.[`${from.id}-${to.id}`];
    console.log(`${from.name} -> ${to.name}: ${note ? (note.soon ? 'ends soon (your note)' : `runs until ${note.until} (your note)`) : 'no note'}`);
    break;
  }
  case 'avail': {
    if (!id) { console.error('usage: chain avail <ship> [regular|event-only|clear]'); process.exit(2); }
    const ship = findShip(ships, id);
    if (!ship) { console.error(`unknown ship ${id}`); process.exit(2); }
    const value = args[2];
    if (value === 'clear') run({ type: 'clearAvailability', shipId: ship.id });
    else if (value) {
      try { run({ type: 'setAvailability', shipId: ship.id, value, note: opt('note', undefined) }); } catch (e) { console.error(`${e.message}\nusage: chain avail <ship> regular|event-only|clear`); process.exit(2); }
    }
    console.log(`${ship.name}: ${availabilityText(shipAvailability(avail(), ship.id))}`);
    break;
  }
  case 'melt': {
    const protect = new Set((opt('protect', '') || '').split(',').filter(Boolean));
    const p = meltPlan(data, state, { protect, expected: hasOverrides ? expected : null, overrides, avail: avail(), session: sess() });
    console.log(meltHeadline(p, hasOverrides));
    if (noEventsNotice(planning())) console.log(noEventsNotice(planning()));
    if (hasOverrides) {
      const note = meltWithoutNote(meltPlan(data, state, { protect, avail: avail(), session: sess() }).candidates.length - p.candidates.length);
      if (note) console.log(note);
    }
    if (!p.finishChains.length && !p.locks.length) {
      console.log(`${MELT_IDLE} Use: chain mode <id> finish`);
    } else {
      for (const l of meltPlanLines(p, name, goalName)) console.log(l);
      if (p.melt.length) {
        for (const m of p.melt) console.log(`    ${meltPickLine(m, name)}`);
        console.log(`${MELT_NOTE} Run "sync hangar" afterwards.`);
      }
    }
    if (flag('all')) for (const c of p.candidates) console.log(`    candidate ${c.copy.copyId}: ${name(c.copy.from)} -> ${name(c.copy.to)} ${usd(c.paid)}`);
    break;
  }
  case 'wanted': {
    const top = Number(opt('top', 12));
    const slack = Math.round(Number(opt('slack', 10)) * 100);
    const ids = id && !id.startsWith('--') ? [getChain(id).id] : Object.values(state.chains).filter((c) => (c.mode ?? 'watch') === 'watch').map((c) => c.id);
    console.log('Which Warbonds RSI offers next is unknown; this only says what a Warbond would have to cost to help.');
    for (const cid of ids) {
      const c = state.chains[cid];
      const w = sess().wanted(cid, slack);
      const label = w.objective === 'allin' ? 'all-in' : 'new money';
      console.log(`\n${cid} ${c.name} · today ${w.best ? `${usd(w.bestCost)} ${label}` : 'no route'}`);
      if (!w.wanted.length) console.log('  no pair where a new Warbond would help');
      else if (w.wanted[0].createsRoute) {
        const t = ships.get(c.target);
        console.log(`  RSI sells no upgrade into ${t.name} today${t.concept ? ' (concept ship: its price rises before release, so any upgrade into it locks today\'s price, Standard included)' : ''}. Any of these would create a route:`);
        for (const x of w.wanted.slice(0, top)) console.log(`    ${name(x.from)} -> ${name(x.to)}: up to ${usd(x.below)} (the msrp difference today)`);
      } else {
        console.log(`  Would help (checked ${w.checked} of ${w.candidates} pairs; a Warbond priced below the amount saves the difference):`);
        const grouped = groupWanted(w);
        const how = (g) => (g.sharePct == null ? 'any discount helps' : `needs ${g.sharePct}% off`);
        const ties = grouped.ties;
        const rest = grouped.needs;
        const show = (g) => {
          const froms = g.items.slice(0, 4).map((x) => `${name(x.from)} below ${usd(x.below)} (Std ${usd(x.standard)})${x.onBestRoute ? '*' : ''}`).join(', ');
          console.log(`    -> ${name(g.to)}: ${how(g)} · from ${froms}${g.items.length > 4 ? ` +${g.items.length - 4} more` : ''}`);
        };
        if (!ties.length) console.log('    (none)');
        ties.slice(0, Math.ceil(top / 2)).forEach(show);
        if (ties.length > Math.ceil(top / 2)) console.log(`    ... ${ties.length - Math.ceil(top / 2)} more targets where any discount helps (--top to show more)`);
        if (rest.length) console.log('  Would help if discounted enough (bigger steps that skip part of the route):');
        rest.slice(0, top).forEach(show);
        if (w.wanted.some((x) => x.onBestRoute)) console.log('    * Standard bridge on today\'s route');
      }
      if (w.holding.length) {
        const sp = w.best ? routeAdvice(null, null, w.best).split : { standardLater: 0 };
        console.log(`  On sale today, not on the best route but at most ${usd(slack)} more (they vanish when the sale ends; an unused one melts back to its price as store credit, which this chain's ${usd(sp.standardLater)} of later Standard steps could use):`);
        for (const h of w.holding) console.log(`    ${name(h.from)} -> ${name(h.to)}: WB ${usd(h.cash)} (Standard ${usd(h.standard)}) · route ${usd(h.extra)} more today`);
      }
    }
    break;
  }
  case 'changes': {
    const c = changesSinceSync(sess(), loadSnapshots());
    if (!c) { console.log('No snapshot of older data yet. scripts/sync.mjs stores one before and after every sync.'); break; }
    console.log(`${changesHeadline(c)} (${usd(c.was)} -> ${usd(c.total)})`);
    for (const g of c.goals) console.log(`  ${goalChangeLine(g, { name, arrow: '->' })}`);
    for (const l of changesGoalLines(c)) console.log(`  ${l}`);
    if (!c.goals.length) console.log('  No goal changed its cost.');
    break;
  }
  case 'warbonds': {
    const hours = Number(opt('hours', 24));
    const file = path.join(DATA_DIR, 'offer-history.jsonl');
    const history = parseHistory(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    const now = Date.now();
    const events = eventsSince(history, hours, now);
    const kindOf = new Map(data.offers.map((o) => [o.skuId, o.kind]));
    const { appeared, disappeared: gone } = recentWarbondEvents(history, data.offers, hours, now);
    const usedBy = sess().warbondUsage();
    console.log(`Last ${hours}h: ${appeared.length} Warbond ${appeared.length === 1 ? 'offer' : 'offers'} appeared, ${gone.length} ${gone.length === 1 ? 'offer' : 'offers'} disappeared`);
    for (const e of appeared) {
      const u = usedBy.get(`${e.fromId}-${e.toId}`);
      console.log(`  + ${name(e.fromId)} -> ${name(e.toId)} ${usd(e.cash)}${u ? `  <- used by ${u.map(goalName).join(', ')}` : ''}`);
    }
    if (flag('gone')) for (const e of gone) console.log(`  - ${name(e.fromId)} -> ${name(e.toId)} ${usd(e.cash)}`);

    // Concept ships rise before release, so any upgrade into one you plan for
    // locks today's price, Standard included. Not-on-sale concepts are often
    // only offered during sales.
    const goal = new Map();
    for (const c of Object.values(state.chains)) if (ships.get(c.target)?.concept) goal.set(c.target, [...(goal.get(c.target) ?? []), c.id]);
    const intoConcept = events.filter((e) => e.event === 'appeared' && ships.get(e.toId)?.concept);
    if (intoConcept.length) {
      console.log(`\nUpgrades into concept ships that appeared (any kind; they lock today's price before the rise):`);
      for (const e of intoConcept) console.log(`  + ${name(e.fromId)} -> ${name(e.toId)} ${kindOf.get(e.skuId) ?? '?'} ${usd(e.cash)}${goal.has(e.toId) ? `  <- target of ${goal.get(e.toId).map(goalName).join(', ')}` : ''}`);
    }
    for (const [t, ids] of goal) {
      const now = data.offers.filter((o) => o.to === t);
      const cheapest = now.sort((a, b) => a.cash - b.cash)[0];
      console.log(`\n${name(t)} (concept${ships.get(t).onSale ? '' : ', not on sale'}, target of ${ids.map(goalName).join(', ')}): ${now.length ? `${now.length} upgrade(s) into it on sale now, cheapest ${name(cheapest.from)} -> ${name(t)} ${cheapest.kind} ${usd(cheapest.cash)}` : 'no upgrade into it on sale now'}`);
    }
    break;
  }
  case 'show': {
    const c = getChain(id);
    const prop = sess().proposal(c.id, Number(opt('k', 3)));
    console.log(`${c.id} ${c.name} [${c.priority}] · uncommitted credit ${usd(prop.credit)}`);
    if (c.accepted) {
      const ev = evaluateAccepted(state, c.id, data);
      console.log(`\nReserved rev ${c.accepted.rev} (${c.accepted.acceptedAt.slice(0, 16)}): ${ev.status} · ${usd(ev.cash)} cash now, ${usd(c.accepted.cash)} when reserved`);
      for (const i of ev.issues) console.log(`  ! ${issueLine(i, { name, goalName, arrow: '->' })}`);
      printRoute(c.accepted);
      printAlerts(adviceFor(c, c.accepted), '  ');
    }
    if (prop.routes[0]?.start && startOf(c).kind === 'token') console.log(`Planned start: ${name(prop.routes[0].start.ship)}${prop.routes[0].start.token ? ` (pledge ${prop.routes[0].start.token.pledgeId})` : ''}`);
    prop.routes.forEach((r, i) => {
      console.log(`\nProposal ${i + 1}: ${routeLine(r)} · ${describeDiff(diffRoutes(c.accepted, r))}`);
      printRoute(r);
    });
    if (!prop.routes.length) console.log(`\n${prop.noToken ? NO_TOKEN_TEXT : 'No route with the CCUs and offers left'}.`);
    const share = sharedEffectLine(sess().sharedEffect(c.id), { name, arrow: '->' });
    if (share) console.log(`\n${share}`);
    break;
  }
  case 'accept': {
    const c = getChain(id);
    const prop = sess().proposal(c.id, 3);
    const r = prop.routes[Number(opt('route', 1)) - 1];
    if (!r) { console.error('no such proposal'); process.exit(2); }
    const acc = run({ type: 'accept', chainId: c.id, route: r });
    console.log(`reserved ${c.id} rev ${acc.rev}: ${routeLine(r)}; held ${acc.steps.filter((s) => s.copyId).length} CCU(s)`);
    break;
  }
  case 'fleet': {
    const f = sess().fleet();
    console.log(`Fleet proposal by priority: ${usd(f.totalCash)} new cash in total, ${usd(f.creditLeft)} credit left`);
    for (const p of f.plans) {
      const c = state.chains[p.chainId];
      console.log(`\n${c.id} [${c.priority}] ${c.name}: ${p.route ? routeLine(p.route) : p.noToken ? NO_TOKEN_TEXT : 'no route'}`);
      if (p.route && flag('verbose')) printRoute(p.route);
    }
    if (flag('accept')) {
      run({ type: 'acceptFleet', plans: f.plans });
      console.log('\nreserved the chains of all goals that had none yet; reserved goals are unchanged');
    }
    break;
  }
  case 'release': {
    run({ type: 'release', chainId: getChain(id).id });
    console.log(`released ${id}; its CCUs are free again`);
    break;
  }
  case 'remove': {
    getChain(id);
    run({ type: 'remove', chainId: id });
    console.log(`removed ${id}`);
    break;
  }
  default:
    console.log('usage: chain add|list|show|accept|refresh|fleet|release|remove|credit|mode|lock|objective|price|prices|melt|event|avail|changes|warbonds|wanted (see header of scripts/chain.mjs)');
    process.exit(2);
}
