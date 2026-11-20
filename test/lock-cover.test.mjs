import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, splitRoute, lockCover, lockCovered, lockDecision } from '../src/logic/chains.mjs';
import { journey } from '../src/logic/journey.mjs';
import { decisionGraph } from '../src/logic/decision.mjs';
import { lockCoveredText } from '../src/logic/describe.mjs';
import { createSession } from '../src/logic/session.mjs';

// The planning session of a setup() result (kept on it, so repeated calls share one); `graph` swaps in another graph.
const S = (x, graph = x.graph) => (x.session?.graph === graph ? x.session : (x.session = createSession({ plans: x.plans, graph })));

// 1 = S (start), 2 = C, 3 = T (concept target), 4 = I (flyable, owns an I -> T CCU)
const NAMES = { 1: 'Start', 2: 'Carrack', 3: 'Orion', 4: 'Ironclad' };
const ships = new Map([1, 2, 3, 4].map((id) => [id, { id, name: NAMES[id], msrp: id * 5000, concept: id === 3 }]));
const TODAY = '2026-11-20';

// Route: owned S -> C, Standard C -> T 5000 (cash 5000). Backup: Standard S -> I `backupCash`, owned I -> T.
function setup({ backupCash = 8000, withCopy = true, extraGoal = false, targetConcept = true, lowGoal = false, offersExtra = [], midStd = false, lastCash = 5000 } = {}) {
  const offers = [
    { kind: 'standard', from: 2, to: 3, cash: lastCash },
    { kind: 'standard', from: 1, to: 4, cash: backupCash },
    ...offersExtra,
  ];
  if (midStd) offers.push({ kind: 'standard', from: 1, to: 2, cash: 2000 });
  const owned = midStd ? [] : [{ from: 1, to: 2, copyId: 'c-sc', paid: { cents: 100 } }];
  if (withCopy) owned.push({ from: 4, to: 3, copyId: 'c-it', paid: { cents: 100 } });
  const plans = newState();
  addChain(plans, { base: 1, target: 3, name: 'Orion' });
  if (extraGoal) addChain(plans, { base: 4, target: 3, name: 'Other', priority: 'high' });
  if (lowGoal) addChain(plans, { base: 4, target: 3, name: 'Low', priority: 'low' });
  const graph = buildGraph({ offers, owned });
  const sh = new Map([...ships].map(([id, s]) => [id, { ...s, concept: id === 3 && targetConcept }]));
  const id = Object.keys(plans.chains).find((k) => plans.chains[k].base === 1 || plans.chains[k].start?.ship === 1);
  const route = proposeChain(plans, id, graph, { k: 1 }).routes[0];
  const app = { data: { ships: sh, offers, owned }, graph, plans, overrides: { ships: {} }, expected: offers, saleEvents: null };
  return { plans, graph, id, route, ships: sh, app };
}
const ctx = (x) => ({ session: S(x), ships: x.ships, overrides: null, expected: x.app.expected, avail: null });

test('covered: an owned CCU into the target caps the rise below the lock step', () => {
  const x = setup({ backupCash: 8000 });
  assert.deepEqual(x.route.steps.map((s) => s.kind), ['owned', 'standard']);
  assert.equal(x.route.cash, 5000);
  const cover = lockCover(S(x), x.id, x.route);
  assert.equal(cover.extraCash, 3000);
  assert.equal(cover.copyId, 'c-it');
  assert.equal(cover.from, 4);
  assert.equal(cover.route.steps.at(-1).kind, 'owned');
  assert.equal(lockCovered(cover, x.route), true);
  assert.equal(lockCover(S(x), x.id, x.route), cover, 'memoised');

  const chain = x.plans.chains[x.id];
  const text = 'Price rise covered: your Ironclad → Orion CCU limits it to $30 more';
  assert.equal(lockCoveredText('Ironclad', 'Orion', 3000), text);

  const j = journey(x.route, chain, ctx(x));
  const last = j.steps.at(-1);
  assert.equal(last.lock, false);
  assert.equal(last.state, 'wait');
  assert.equal(last.cover, text);
  assert.equal(j.steps.filter((s) => s.lock).length, 0);
  assert.equal(last.alert, null, 'no buy-before alert for a covered step');

  const g = decisionGraph(x.app, x.id, { wanted: null, today: TODAY });
  const step = g.steps.at(-1);
  assert.equal(step.cover, text);
  assert.ok(step.decision.endsWith(text));
  assert.doesNotMatch(step.decision, /lock now/);
});

test('not covered: the extra cost is above the lock step, so the lock stays', () => {
  const x = setup({ backupCash: 13000 });
  const cover = lockCover(S(x), x.id, x.route);
  assert.equal(cover.extraCash, 8000);
  assert.equal(lockCovered(cover, x.route), false);
  const chain = x.plans.chains[x.id];
  const last = journey(x.route, chain, ctx(x)).steps.at(-1);
  assert.equal(last.lock, true);
  assert.equal(last.cover, null);
  assert.equal(splitRoute(x.route, { lock: lockDecision(S(x), chain, x.route, { ships: x.ships }).lock }).lockNow.length, 1);
  assert.equal(decisionGraph(x.app, x.id, { wanted: null, today: TODAY }).steps.at(-1).cover, undefined);
});

test('exactly as much as the lock step still counts as covered', () => {
  const x = setup({ backupCash: 10000 });
  assert.equal(lockCover(S(x), x.id, x.route).extraCash, 5000);
  assert.equal(lockDecision(S(x), x.plans.chains[x.id], x.route, { ships: x.ships }).lock, false);
});

test('no owned copy into the target: no cover, the lock stays', () => {
  const x = setup({ withCopy: false });
  assert.equal(lockCover(S(x), x.id, x.route), null);
  const dec = lockDecision(S(x), x.plans.chains[x.id], x.route, { ships: x.ships });
  assert.equal(dec.reason, 'concept');
  assert.equal(dec.lock, true);
  assert.equal(journey(x.route, x.plans.chains[x.id], ctx(x)).steps.at(-1).lock, true);
});

test('an owned copy claimed by another goal does not count as cover', () => {
  const x = setup({ extraGoal: true });
  assert.equal(lockCover(S(x), x.id, x.route), null);
  assert.equal(journey(x.route, x.plans.chains[x.id], ctx(x)).steps.at(-1).lock, true);
});

test('the last step is owned or a Warbond: no cover', () => {
  const x = setup();
  const owned = { steps: [{ kind: 'owned', from: 4, to: 3, copyId: 'c-it', cash: 0 }], cash: 0 };
  const warbond = { steps: [{ kind: 'warbond', from: 2, to: 3, cash: 4000 }], cash: 4000 };
  assert.equal(lockCover(S(x), x.id, owned), null);
  assert.equal(lockCover(S(x), x.id, warbond), null);
  assert.equal(lockCover(S(x), x.id, null), null);
  assert.equal(lockCovered(null, x.route), false);
});

test('without a lock reason no cover search runs', () => {
  const x = setup({ targetConcept: false });
  const dec = lockDecision(S(x), x.plans.chains[x.id], x.route, { ships: x.ships });
  assert.deepEqual([dec.reason, dec.cover, dec.lock], [null, null, false]);
  const off = lockDecision(S(x), { ...x.plans.chains[x.id], lock: 'off' }, x.route, { ships: x.ships });
  assert.equal(off.cover, null);
});

test('Today: a covered step is not a purchase for today; an uncovered one is', async () => {
  const { todayView } = await import('../app/src/lib/view/today.mjs');
  const covered = setup({ backupCash: 8000 });
  const a = todayView(covered.app, TODAY);
  assert.equal(a.buys.length, 0);
  const open = setup({ backupCash: 13000 });
  const b = todayView(open.app, TODAY);
  assert.deepEqual(b.buys.map((x) => [x.step.to, x.lock]), [[3, true]]);
});

test('a copy another goal plans to use is not cover', () => {
  const x = setup({ lowGoal: true });
  const low = Object.values(x.plans.chains).find((c) => c.name === 'Low');
  assert.equal(proposeChain(x.plans, low.id, x.graph, { k: 1 }).routes[0].steps[0].copyId, 'c-it');
  assert.equal(lockCover(S(x), x.id, x.route), null);
  const last = journey(x.route, x.plans.chains[x.id], ctx(x)).steps.at(-1);
  assert.equal(last.lock, true, 'the lock is back');
});

test('another free copy of the pair can still cover when one is used elsewhere', () => {
  const x = setup({ lowGoal: true });
  x.graph.edges.get(4).find((e) => e.kind === 'owned').copies.push({ copyId: 'c-it2', paid: { cents: 100 } });
  const cover = lockCover(S(x), x.id, x.route);
  assert.equal(cover?.copyId, 'c-it2');
});

test('accepted route: the cover is judged at today\'s prices, not the stored cash', async () => {
  const { acceptRoute } = await import('../src/logic/chains.mjs');
  const x = setup({ backupCash: 8000 });
  acceptRoute(x.plans, x.id, x.route); // stored cash 5000
  const offers = [{ kind: 'standard', from: 2, to: 3, cash: 6000 }, { kind: 'standard', from: 1, to: 4, cash: 8000 }];
  const graph = buildGraph({ offers, owned: x.app.data.owned });
  const cover = lockCover(S(x, graph), x.id, x.plans.chains[x.id].accepted);
  assert.equal(cover.extraCash, 2000, '8000 backup - 6000 today, not 3000');
  assert.equal(cover.lockCash, 6000);
});

test('a cheaper Warbond into the target does not replace the owned backup', () => {
  const x = setup({ offersExtra: [{ kind: 'warbond', from: 1, to: 3, cash: 6000, skuId: 1 }] });
  const cover = lockCover(S(x), x.id, x.route);
  assert.equal(cover.route.steps.at(-1).kind, 'owned');
  assert.equal(cover.extraCash, 3000);
});

test('an alert on another step survives when the last step is covered', () => {
  const x = setup({ midStd: true });
  assert.deepEqual(x.route.steps.map((s) => s.kind), ['standard', 'standard']);
  const expected = [{ kind: 'standard', from: 1, to: 2, cash: 3000 }, { kind: 'standard', from: 2, to: 3, cash: 5000 }];
  const j = journey(x.route, x.plans.chains[x.id], { ...ctx(x), expected });
  assert.equal(j.steps[1].cover != null, true);
  assert.equal(j.steps[1].alert, null);
  assert.match(j.steps[0].alert, /Start → Carrack/);
});

test('melt: a covered goal reserves nothing for its lock', async () => {
  const { meltPlan } = await import('../src/logic/melt.mjs');
  const { acceptRoute } = await import('../src/logic/chains.mjs');
  const mk = (backupCash) => {
    const x = setup({ backupCash });
    acceptRoute(x.plans, x.id, x.route);
    return meltPlan(x.app.data, x.plans, {});
  };
  const covered = mk(8000);
  assert.equal(covered.locks.length, 0);
  assert.equal(covered.need, 0);
  const open = mk(13000);
  assert.equal(open.locks.length, 1);
  assert.equal(open.need, 5000);
});

test('two goals never share one cover copy: the earlier goal is covered, the other keeps its lock', () => {
  const offers = [{ kind: 'standard', from: 2, to: 3, cash: 5000 }, { kind: 'standard', from: 1, to: 4, cash: 8000 }, { kind: 'standard', from: 1, to: 2, cash: 2000 }];
  const graph = buildGraph({ offers, owned: [{ from: 4, to: 3, copyId: 'c-it', paid: { cents: 1 } }] });
  const plans = newState();
  const a = addChain(plans, { base: 1, target: 3, name: 'A' });
  const b = addChain(plans, { base: 1, target: 3, name: 'B' });
  const session = createSession({ plans, graph });
  const decide = (c) => lockDecision(session, c, session.route(c.id), { ships });
  const da = decide(a); const db = decide(b);
  assert.equal(da.covered, true);
  assert.equal(da.cover.extraCash, 1000);
  assert.equal(db.covered, false);
  assert.equal(db.lock, true);
  // Asking B first changes nothing.
  assert.equal(lockCover(session, b.id, session.route(b.id)), null);
  const m = (c) => lockCover(session, c.id, session.route(c.id))?.copyId ?? null;
  assert.deepEqual([m(a), m(b)], ['c-it', null]);
});

test('a goal with no lock reason does not take a cover copy', () => {
  const offers = [{ kind: 'standard', from: 2, to: 3, cash: 5000 }, { kind: 'standard', from: 1, to: 4, cash: 8000 }, { kind: 'standard', from: 1, to: 2, cash: 2000 }];
  const graph = buildGraph({ offers, owned: [{ from: 4, to: 3, copyId: 'c-it', paid: { cents: 1 } }] });
  const plans = newState();
  const a = addChain(plans, { base: 1, target: 3, name: 'A' });
  plans.chains[a.id].lock = 'off';
  const b = addChain(plans, { base: 1, target: 3, name: 'B' });
  const session = createSession({ plans, graph });
  const route = (c) => session.route(c.id);
  assert.equal(lockDecision(session, b, route(b), { ships }).covered, true);
  assert.equal(lockDecision(session, a, route(a), { ships }).lock, false);
});

test('a route step that is not on offer today gives no cover', async () => {
  const { acceptRoute } = await import('../src/logic/chains.mjs');
  const x = setup({ backupCash: 8000 });
  acceptRoute(x.plans, x.id, x.route);
  const graph = buildGraph({ offers: [{ kind: 'standard', from: 1, to: 4, cash: 8000 }], owned: x.app.data.owned });
  assert.equal(lockCover(S(x, graph), x.id, x.plans.chains[x.id].accepted), null);
});
