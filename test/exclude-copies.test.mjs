import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, acceptRoute } from '../src/logic/chains.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { creditCommitted } from '../src/logic/goals.mjs';
import { aloneRoute } from '../src/logic/sharedEffect.mjs';
import { createSession } from '../src/logic/session.mjs';
import { emptyOverrides } from '../src/logic/prices.mjs';

const ships = new Map([1, 2, 3].map((id) => [id, { id, name: `S${id}`, msrp: id * 5000, concept: false, owned: false, onSale: true }]));
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });
const offers = [std(1, 2, 5000), std(2, 3, 5000)];
const owned = [{ copyId: 'c12', from: 1, to: 2, name: 'S1 to S2', edition: 'Warbond', paid: { cents: 500 } }];
const graph = buildGraph({ offers, owned, ships });
const plansWith = (excluded = []) => {
  const s = newState();
  addChain(s, { start: { kind: 'ship', ship: 1 }, target: 3 });
  s.profile.excludedCopies = excluded;
  return s;
};
const best = (s) => proposeChain(s, 'c1', graph, { k: 1 }).routes[0];

test('an excluded copy is never used: the plan buys that step instead', () => {
  assert.deepEqual(best(plansWith()).steps.map((x) => x.kind), ['owned', 'standard']);
  const r = best(plansWith(['c12']));
  assert.deepEqual(r.steps.map((x) => x.kind), ['standard', 'standard']);
  assert.equal(r.cash, 10000);
});

test('"planned alone" keeps your exclusions', () => {
  const s = plansWith(['c12']);
  const session = createSession({ plans: s, graph, overrides: emptyOverrides() });
  assert.deepEqual(aloneRoute(session, 'c1').steps.map((x) => x.kind), ['standard', 'standard']);
});

test('excludeCopy: excluding releases a reservation that holds the copy, including it again restores the plan', () => {
  const s = plansWith();
  acceptRoute(s, 'c1', best(s), {}, { graph });
  const doc = { plans: s, overrides: emptyOverrides() };
  const out = applyAction(doc, { type: 'excludeCopy', copyId: 'c12', excluded: true });
  assert.deepEqual(out.result, ['c1']);
  assert.equal(out.plans.chains.c1.accepted, null);
  assert.deepEqual(out.plans.profile.excludedCopies, ['c12']);
  const back = applyAction({ ...doc, plans: out.plans }, { type: 'excludeCopy', copyId: 'c12', excluded: false });
  assert.deepEqual(back.plans.profile.excludedCopies, []);
  assert.deepEqual(best(back.plans).steps.map((x) => x.kind), ['owned', 'standard']);
  assert.throws(() => applyAction(doc, { type: 'excludeCopy', copyId: 12, excluded: true }), /copyId/);
});

test('an excluded copy does not count as the bought step of a reserved Standard upgrade (its credit stays committed)', () => {
  const s = plansWith();
  s.profile.credit = 5000;
  // A reservation that buys 1 -> 2 as a Standard step with credit.
  s.chains.c1.accepted = { steps: [{ ...std(1, 2, 5000) }, { from: 2, to: 3, kind: 'warbond', cash: 3000 }], creditUsed: 5000, cash: 5000 };
  assert.equal(creditCommitted(s, null, graph), 0, 'the owned copy counts as that step bought');
  s.profile.excludedCopies = ['c12'];
  assert.equal(creditCommitted(s, null, graph), 5000);
});
