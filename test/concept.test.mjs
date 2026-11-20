import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, expectedChanges, splitRoute, lockReason, setLock, acceptRoute } from '../src/logic/chains.mjs';
import { classifyCopies, KEEP, meltPlan } from '../src/logic/melt.mjs';
import { expectedOffers } from '../src/logic/prices.mjs';
import { wantedWarbonds } from '../src/logic/wanted.mjs';

// Every ship marked regular by you: the availability gate lets old melt rules decide.
const regular = (ids) => ({ overrides: { ships: Object.fromEntries(ids.map((i) => [i, { availability: 'regular' }])) }, today: '2026-11-18' });

// 0 flyable $50, 1 flyable $75, 2 concept $100 (on sale), 3 concept $150 (not on sale)
const ships = new Map([
  [0, { id: 0, msrp: 5000, concept: false }], [1, { id: 1, msrp: 7500, concept: false }],
  [2, { id: 2, msrp: 10000, concept: true, onSale: true }], [3, { id: 3, msrp: 15000, concept: true, onSale: false }],
]);
const std = (f, t) => ({ from: f, to: t, kind: 'standard', cash: ships.get(t).msrp - ships.get(f).msrp });
const copy = (copyId, from, to, paid) => ({ copyId, from, to, paid: { cents: paid }, meltable: true, extras: [] });

test('a zero-saving CCU into a concept ship is kept, one out of it is not', () => {
  const offers = [std(0, 1), std(0, 2), std(2, 3)];
  const owned = [copy('into', 0, 2, 5000), copy('flyable', 0, 1, 2500)];
  const res = Object.fromEntries(classifyCopies({ owned, offers, ships }, newState(), { avail: regular([0, 1, 2, 3]) }).map((c) => [c.copy.copyId, c]));
  assert.equal(res.into.keep, KEEP.CONCEPT);
  assert.equal(res.flyable.candidate, true);
});

test('a Standard step into a concept ship is flagged buy-before, unless you set an expected price', () => {
  const offers = [std(0, 1), std(1, 2)];
  const s = newState();
  const c = addChain(s, { base: 0, target: 2 });
  const route = proposeChain(s, c.id, buildGraph({ offers }), { k: 1 }).routes[0];
  const ch = expectedChanges(route, offers, ships);
  assert.deepEqual(ch.buyBefore.map((a) => [a.step.from, a.step.to, a.reason]), [[1, 2, 'concept']]);
  const exp = expectedOffers(offers, ships, { ships: { 2: { msrp: 12000 } } });
  const withPrice = expectedChanges(route, exp, ships);
  assert.deepEqual(withPrice.buyBefore.map((a) => [a.reason, a.expected]), [['pricier', 4500]]);
  assert.equal(expectedChanges(route, offers).buyBefore.length, 0, 'without ships nothing is known about concepts');
});

test('a target RSI does not sell: wanted lists the upgrades that would create a route', () => {
  const offers = [std(0, 1), std(1, 2)];
  const s = newState();
  const c = addChain(s, { base: 0, target: 3 });
  const w = wantedWarbonds(s, c.id, buildGraph({ offers }), ships);
  assert.equal(w.best, null);
  const direct = w.wanted.find((x) => x.from === 0 && x.to === 3);
  assert.equal(direct.createsRoute, true);
  assert.equal(direct.below, 10000);
  assert.ok(w.wanted.some((x) => x.from === 2 && x.to === 3 && x.below === 5000));
});

test('lock: the Standard last step into a rising target moves to "now"', () => {
  const offers = [std(0, 1), std(1, 2)];
  const s = newState();
  const c = addChain(s, { base: 0, target: 2 });
  const route = proposeChain(s, c.id, buildGraph({ offers }), { k: 1 }).routes[0];
  const locked = splitRoute(route, { lock: true });
  assert.deepEqual(locked.lockNow.map((x) => [x.from, x.to]), [[1, 2]]);
  assert.equal(locked.lockCash, 2500);
  assert.equal(locked.standardLater, 2500, 'only the bridge before it waits');
  assert.equal(splitRoute(route).standardLater, 5000);
  const owned = proposeChain(s, c.id, buildGraph({ offers, owned: [copy('last', 1, 2, 2500)] }), { k: 1 }).routes[0];
  assert.equal(splitRoute(owned, { lock: true }).lockedBy.copyId, 'last');
});

test('lock auto: concept or a higher expected price; on/off override', () => {
  const s = newState();
  const flyable = addChain(s, { base: 0, target: 1 });
  const concept = addChain(s, { base: 0, target: 2 });
  assert.equal(lockReason(s.chains[flyable.id], ships), null);
  assert.equal(lockReason(s.chains[concept.id], ships), 'concept');
  assert.equal(lockReason(s.chains[flyable.id], ships, { ships: { 1: { msrp: 9000 } } }), 'expected');
  assert.equal(lockReason(s.chains[flyable.id], ships, { ships: { 1: { msrp: 6000 } } }), null, 'a lower expected price is no reason to lock');
  setLock(s, concept.id, 'off');
  assert.equal(lockReason(s.chains[concept.id], ships), null);
  setLock(s, flyable.id, 'on');
  assert.equal(lockReason(s.chains[flyable.id], ships), 'on');
  assert.throws(() => setLock(s, flyable.id, 'maybe'));
});

test('melt plan counts a waiting chain\'s lock step as Standard spend', () => {
  const offers = [std(0, 1), std(1, 2), std(0, 2)];
  const owned = [copy('spare', 0, 1, 2500)];
  const s = newState();
  const c = addChain(s, { base: 0, target: 2 });
  const g = buildGraph({ offers });
  acceptRoute(s, c.id, proposeChain(s, c.id, g, { k: 1 }).routes[0]);
  const p = meltPlan({ owned, offers, ships }, s, { avail: regular([0, 1, 2, 3]) });
  assert.equal(p.locks.length, 1);
  assert.equal(p.need, s.chains[c.id].accepted.steps.at(-1).cash);
  assert.equal(p.melt.length, 1, 'the spare $25 CCU funds the lock');
  setLock(s, c.id, 'off');
  assert.equal(meltPlan({ owned, offers, ships }, s, { avail: regular([0, 1, 2, 3]) }).need, 0);
});
