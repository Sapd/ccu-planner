import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, acceptRoute, splitRoute, recordSeen } from '../src/logic/chains.mjs';
import { classifyCopies, pickMelts, meltPlan } from '../src/logic/melt.mjs';

// Every ship marked regular by you: the availability gate lets old melt rules decide.
const regular = (ids) => ({ overrides: { ships: Object.fromEntries(ids.map((i) => [i, { availability: 'regular' }])) }, today: '2026-11-18' });
const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000 };
const standard = () => {
  const out = [];
  for (const f of [1, 2, 3, 4, 5]) for (const t of [1, 2, 3, 4, 5]) if (MSRP[t] > MSRP[f]) out.push({ from: f, to: t, kind: 'standard', cash: MSRP[t] - MSRP[f] });
  return out;
};
const copy = (copyId, from, to, paid, extra = {}) => ({ copyId, from, to, paid: { cents: paid }, meltable: true, extras: [], ...extra });

test('classify: only unreserved, rebuyable, zero-saving copies without extras are candidates', () => {
  const offers = standard();
  const owned = [
    copy('ok', 1, 2, 2500), // std 1->2 = $25, paid $25 -> saving 0
    copy('saves', 1, 3, 2000), // std $50, paid $20 -> saves $30
    copy('ins', 1, 2, 2500, { extras: ['120 Month Insurance'] }),
    copy('nomelt', 1, 2, 2500, { meltable: false }),
    copy('legacy', 4, 3, 1000), // no standard offer 4->3
    copy('res', 2, 3, 2500),
  ];
  const s = newState();
  const a = addChain(s, { base: 2, target: 3 });
  acceptRoute(s, a.id, proposeChain(s, a.id, buildGraph({ offers, owned })).routes[0]);
  const byId = Object.fromEntries(classifyCopies({ owned, offers }, s, { avail: regular([1, 2, 3, 4, 5]) }).map((c) => [c.copy.copyId, c]));
  assert.equal(byId.ok.candidate, true);
  assert.match(byId.saves.keep, /cheaper/);
  assert.match(byId.ins.keep, /extras/);
  assert.match(byId.nomelt.keep, /not meltable/);
  assert.match(byId.legacy.keep, /no Standard offer for this upgrade at the last sync/);
  assert.match(byId.res.keep, /reserved by c1/);
});

test('pickMelts covers the need with few melts and keeps one copy of a pair if possible', () => {
  const mk = (id, from, to, paid) => ({ copy: { copyId: id, from, to }, paid, candidate: true });
  const cands = [mk('a1', 1, 2, 1000), mk('a2', 1, 2, 1000), mk('b', 3, 4, 5000), mk('c', 2, 3, 500)];
  const { melt, credit } = pickMelts(cands, 1500);
  assert.ok(credit >= 1500);
  assert.equal(melt.filter((m) => m.copy.from === 1).length <= 1 || melt.some((m) => m.copy.copyId === 'b'), true);
  assert.deepEqual(pickMelts(cands, 0), { melt: [], credit: 0 });
  assert.equal(pickMelts(cands, 999999).credit, 7500, 'cannot exceed what exists');
});

test('melt plan: finish chain Standard spend is covered by melting, credit counted once', () => {
  const offers = standard();
  const owned = [copy('m1', 1, 2, 2500), copy('m2', 1, 2, 2500), copy('m3', 3, 4, 5000)];
  const s = newState();
  const c = addChain(s, { base: 2, target: 5, mode: 'finish' }); // needs $125 standard
  acceptRoute(s, c.id, proposeChain(s, c.id, buildGraph({ offers, owned: [] })).routes[0]);
  const plan = meltPlan({ owned, offers }, s, { avail: regular([1, 2, 3, 4, 5]) });
  assert.equal(plan.standard, 12500);
  assert.equal(plan.newMoneyBefore, 12500);
  assert.equal(plan.meltCredit, 10000, 'all three candidates, $100');
  assert.equal(plan.newMoneyAfter, 2500);
  s.profile.credit = 5000;
  const p2 = meltPlan({ owned, offers }, s, { avail: regular([1, 2, 3, 4, 5]) });
  assert.equal(p2.need, 7500);
  assert.ok(p2.meltCredit >= 7500 && p2.meltCredit <= 10000);
  assert.equal(p2.newMoneyAfter, 0);
});

test('watch chains are not part of the melt plan; warbond always needs new money', () => {
  const offers = [...standard(), { from: 2, to: 4, kind: 'warbond', cash: 2000 }];
  const s = newState();
  const w = addChain(s, { base: 1, target: 5 }); // watch by default
  acceptRoute(s, w.id, proposeChain(s, w.id, buildGraph({ offers })).routes[0]);
  const plan = meltPlan({ owned: [copy('m', 1, 2, 2500)], offers }, s);
  assert.deepEqual(plan.finishChains, []);
  assert.equal(plan.melt.length, 0);
  const split = splitRoute(s.chains[w.id].accepted);
  assert.equal(split.cashNow, 2000, 'only the Warbond is worth buying while waiting');
  assert.equal(split.standardLater, 7500);
});

test('recordSeen reports a new Warbond that lowers the chain', () => {
  const s = newState();
  const c = addChain(s, { base: 1, target: 5 });
  const r1 = proposeChain(s, c.id, buildGraph({ offers: standard() })).routes[0];
  assert.equal(recordSeen(s, c.id, r1, 'day1').kind, 'first');
  const r2 = proposeChain(s, c.id, buildGraph({ offers: [...standard(), { from: 2, to: 4, kind: 'warbond', cash: 2000 }] })).routes[0];
  const ch = recordSeen(s, c.id, r2, 'day2');
  assert.equal(ch.kind, 'changed');
  assert.equal(ch.cashBefore, 15000);
  assert.equal(ch.cashAfter, 9500); // 1->2 $25 std, 2->4 $20 WB, 4->5 $50 std
  assert.equal(ch.newWarbonds.length, 1);
  assert.equal(recordSeen(s, c.id, r2, 'day3').kind, 'unchanged');
});
