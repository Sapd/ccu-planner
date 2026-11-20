import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAdvice } from '../src/logic/advice.mjs';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { createSession } from '../src/logic/session.mjs';
import { lockCoveredText } from '../src/logic/describe.mjs';

// ----- grouping (what the step list shows) -----
const ships = new Map([[1, { id: 1, msrp: 100, name: 'A' }], [2, { id: 2, msrp: 200, name: 'B' }], [3, { id: 3, msrp: 300, name: 'C' }], [4, { id: 4, msrp: 400, name: 'T' }]]);
const route = { steps: [
  { from: 1, to: 2, kind: 'warbond', cash: 50 },
  { from: 2, to: 3, kind: 'owned', copyId: 'x' },
  { from: 3, to: 4, kind: 'standard', cash: 100 },
  { from: 3, to: 4, kind: 'standard', cash: 10 },
] };
const titles = (adv) => Object.entries(adv.groups).filter(([, s]) => s.length).map(([t, s]) => [t, s.length]);
const ov = { ships: {} };
const advise = (chain) => routeAdvice(null, chain, route, { ships, overrides: ov });

test('watch: Warbonds buy now, Standards later, owned grouped', () => {
  assert.deepEqual(titles(advise({ mode: 'watch', target: 4, lock: 'off' })), [['buyNow', 1], ['later', 2], ['owned', 1]]);
});

test('missing mode behaves as watch', () => {
  assert.deepEqual(titles(advise({ target: 4, lock: 'off' })), [['buyNow', 1], ['later', 2], ['owned', 1]]);
});

test('finish: every non-owned step is buy now, and nothing locks', () => {
  const adv = advise({ mode: 'finish', target: 4, lock: 'on' });
  assert.deepEqual(titles(adv), [['buyNow', 3], ['owned', 1]]);
  assert.equal(adv.finish, true);
  assert.deepEqual([adv.lockCode, adv.dec.lock, adv.skip], [null, false, []]);
});

test('lock now applies through lockReason to the last Standard step', () => {
  const adv = advise({ mode: 'watch', target: 4, lock: 'on' });
  assert.deepEqual(titles(adv), [['buyNow', 1], ['lockNow', 1], ['later', 1], ['owned', 1]]);
  assert.equal(adv.groups.lockNow[0].cash, 10);
  assert.equal(adv.lockCode, 'on');
  assert.deepEqual(adv.skip, adv.groups.lockNow);
  assert.equal(adv.split.lockCash, 10);
});

test('a free-standing route (no goal) is not split by a lock and is not finish', () => {
  const adv = routeAdvice(null, null, route, { ships });
  assert.deepEqual(titles(adv), [['buyNow', 1], ['later', 2], ['owned', 1]]);
  assert.equal(adv.finish, false);
  assert.equal(adv.lockCode, null);
});

// ----- alerts, skip list, cover -----
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });

test('alerts are worded once, in route order, without the skipped steps; cheaper steps are listed apart', () => {
  const offers = [std(1, 2, 1000), std(2, 4, 1000)];
  const expected = [std(1, 2, 1500), std(2, 4, 900)];
  const nm4 = new Map([[1, { id: 1, name: 'One', msrp: 0 }], [2, { id: 2, name: 'Two', msrp: 1000 }], [4, { id: 4, name: 'Four', msrp: 2000 }]]);
  const r = { steps: offers.map((o) => ({ ...o })), cash: 2000, creditUsed: 0 };
  const adv = routeAdvice(null, { id: 'c1', mode: 'finish', target: 4 }, r, { ships: nm4, expected });
  assert.deepEqual(adv.alerts.map((a) => [a.step.to, a.reason]), [[2, 'pricier']]);
  assert.equal(adv.alerts[0].text, 'Buy before the price changes: One → Two $10 now, $15 after');
  assert.deepEqual(adv.cheaper.map((a) => a.step.to), [4]);
  assert.equal(adv.changes, adv.changes, 'computed once');
  assert.equal(adv.laterExpected, 0, 'a finish goal has no later steps');
});

test('the locked step gets no alert; the other Standard steps do', () => {
  const offers = [std(1, 2, 1000), std(2, 4, 1000)];
  const expected = [std(1, 2, 1500), std(2, 4, 1500)];
  const nm4 = new Map([[1, { id: 1, name: 'One', msrp: 0 }], [2, { id: 2, name: 'Two', msrp: 1000 }], [4, { id: 4, name: 'Four', msrp: 2000 }]]);
  const r = { steps: offers.map((o) => ({ ...o })), cash: 2000, creditUsed: 0 };
  const adv = routeAdvice(null, { id: 'c1', mode: 'watch', target: 4, lock: 'on' }, r, { ships: nm4, expected });
  assert.deepEqual(adv.groups.lockNow.map((s) => s.to), [4]);
  assert.deepEqual(adv.alerts.map((a) => a.step.to), [2]);
  assert.equal(adv.laterExpected, 1500, 'the one later step at its expected price');
});

test('a covered step is skipped and carries the cover text', () => {
  // 1 -> 2 -> 4 by Standard; an owned CCU 3 -> 4 backs up the target.
  const offers = [std(1, 2, 1000), std(2, 4, 1000), std(1, 3, 3000)];
  const plans = newState();
  const chain = addChain(plans, { base: 1, target: 4 });
  chain.lock = 'on';
  const graph = buildGraph({ offers, owned: [{ from: 3, to: 4, copyId: 'k', paid: { cents: 100 } }] });
  const session = createSession({ plans, graph });
  const names = new Map([[1, { id: 1, name: 'One', msrp: 0 }], [2, { id: 2, name: 'Two', msrp: 1000 }], [3, { id: 3, name: 'Three', msrp: 3000 }], [4, { id: 4, name: 'Four', msrp: 4000 }]]);
  const r = session.route('c1');
  const adv = routeAdvice(session, chain, r, { ships: names, expected: offers });
  assert.equal(adv.dec.covered, true);
  assert.equal(adv.lockCode, null);
  assert.deepEqual(adv.skip, [adv.dec.coveredStep]);
  assert.equal(adv.coverText, lockCoveredText('Three', 'Four', adv.dec.cover.extraCash));
});
