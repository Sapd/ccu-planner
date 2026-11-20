import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, copy, ships } from './support/ladder.mjs';
import { acceptRoute, addChain } from '../src/logic/chains.mjs';
import { creditCommitted, evaluateAccepted, newState } from '../src/logic/goals.mjs';
import { buildGraph, planRoutes } from '../src/logic/planner.mjs';
import { createSession } from '../src/logic/session.mjs';

const copiesOf = (route) => route.steps.filter((s) => s.copyId).map((s) => s.copyId);

test('one unreserved owned copy releases the credit of one accepted goal and is used by no other goal', () => {
  // $50 credit, one owned 3->4 copy. G1 (draft) and G2 both want 3->4; G2 is accepted as a Standard step paid with the credit.
  const { app, ids } = setup({ credit: 5000, owned: [copy('o1', 3, 4, 2000)], goals: [{ base: 3, target: 4 }, { base: 3, target: 4 }] });
  let s = createSession({ plans: app.plans, graph: app.graph, data: app.data });
  assert.deepEqual(copiesOf(s.route(ids[0])), ['o1']);
  acceptRoute(app.plans, ids[1], s.route(ids[1]), {}, { graph: app.graph });
  assert.equal(app.plans.chains[ids[1]].accepted.creditUsed, 5000);
  const g3 = addChain(app.plans, { start: { kind: 'ship', ship: 3 }, target: 5 }).id;
  s = createSession({ plans: app.plans, graph: app.graph, data: app.data });
  // G2 now owns the copy for its step (its credit is released); no other goal may plan onto the same copy.
  assert.equal(creditCommitted(app.plans, null, app.graph), 0);
  assert.deepEqual(copiesOf(s.route(ids[0])), [], 'G1 must not use the copy G2 holds');
  assert.deepEqual(copiesOf(s.route(g3)), []);
  // Credit is never handed out twice: what the other goals are given plus what accepted goals still hold fits the balance.
  let drafts = 0;
  for (const [id, e] of s.shared) if (!app.plans.chains[id].accepted) drafts += e.route?.creditUsed ?? 0;
  assert.ok(drafts + creditCommitted(app.plans, null, app.graph) <= app.plans.profile.credit, `allocated ${drafts}`);
});

test('two accepted goals do not both count one unreserved copy as their bought step', () => {
  const { app, ids } = setup({ credit: 10000, owned: [copy('o1', 3, 4, 2000)], goals: [{ base: 3, target: 4 }, { base: 3, target: 4 }] });
  // Both reserved as Standard steps with $50 credit each: only one of them can be satisfied by the single copy.
  const std = (id) => ({ steps: [{ kind: 'standard', from: 3, to: 4, cash: 5000 }], cash: 0, creditUsed: 5000, start: { ship: 3 } });
  for (const id of ids) acceptRoute(app.plans, id, std(id), {}, { graph: null });
  assert.equal(creditCommitted(app.plans, null, app.graph), 5000);
});

test('a copy bought for an accepted goal without store credit is not planned onto by a second goal', () => {
  const { app, ids } = setup({ goals: [{ base: 2, target: 3, mode: 'finish' }] });
  acceptRoute(app.plans, ids[0], createSession({ plans: app.plans, graph: app.graph, data: app.data }).route(ids[0]), {}, { graph: app.graph });
  const b = addChain(app.plans, { start: { kind: 'ship', ship: 2 }, target: 3, mode: 'finish' }).id;
  // The user buys the Standard 2->3 for the accepted goal.
  const owned = [copy('n1', 2, 3, 2500)];
  const data = { ...app.data, owned };
  const graph = buildGraph({ offers: data.offers, owned, ships });
  const s = createSession({ plans: app.plans, graph, data });
  assert.deepEqual(copiesOf(s.route(b)), [], 'the copy is the accepted goal\'s');
  assert.equal(s.route(b).cash, 2500);
});

test('an accepted chain whose Warbond step is now owned is not blocked when the Warbond leaves the store', () => {
  const sh = new Map([[1, { id: 1, name: 'A', msrp: 10000 }], [2, { id: 2, name: 'B', msrp: 20000 }], [3, { id: 3, name: 'C', msrp: 30000 }]]);
  const wb = { from: 1, to: 2, kind: 'warbond', cash: 1000, skuId: 1 };
  const std = { from: 2, to: 3, kind: 'standard', cash: 1000, skuId: 2 };
  const [r] = planRoutes(buildGraph({ offers: [wb, std], owned: [], ships: sh }), { base: 1, target: 3 }, 1);
  const state = newState();
  const c = addChain(state, { name: 'g', base: 1, target: 3, mode: 'finish' });
  acceptRoute(state, c.id, r, {});
  const owned = [{ copyId: '99', from: 1, to: 2, paid: 1000 }];
  const ev = evaluateAccepted(state, c.id, { offers: [std], owned, lti: [] });
  assert.deepEqual(ev.issues, []);
  assert.notEqual(ev.status, 'blocked');
  // Still blocked when the copy is not there (or another goal holds it).
  assert.equal(evaluateAccepted(state, c.id, { offers: [std], owned: [], lti: [] }).status, 'blocked');
});

test('a reserved Warbond step you bought while it is still on sale counts as owned, not as still to buy', async () => {
  const { buildGraph } = await import('../src/logic/planner.mjs');
  const { newState, addChain, proposeChain, acceptRoute, evaluateAccepted, planGoals } = await import('../src/logic/chains.mjs');
  const ships = new Map([1, 2, 3].map((id) => [id, { id, name: `S${id}`, msrp: id * 5000 }]));
  const offers = [{ from: 1, to: 2, kind: 'warbond', cash: 2000 }, { from: 2, to: 3, kind: 'standard', cash: 5000 }];
  const s = newState();
  addChain(s, { start: { kind: 'ship', ship: 1 }, target: 3 });
  const before = buildGraph({ offers, ships });
  acceptRoute(s, 'c1', proposeChain(s, 'c1', before, { k: 1 }).routes[0], {}, { graph: before });
  const owned = [{ copyId: 'p1', from: 1, to: 2, paid: { cents: 2000 } }];
  const after = buildGraph({ offers, owned, ships });
  const r = planGoals(s, after).get('c1').route;
  assert.deepEqual(r.steps.map((x) => [x.kind, x.copyId ?? null]), [['owned', 'p1'], ['standard', null]]);
  assert.equal(r.cash, 5000);
  assert.equal(evaluateAccepted(s, 'c1', { offers, owned }).cash, 5000);
  // A second goal cannot take that copy: it settles the reserved step.
  addChain(s, { start: { kind: 'ship', ship: 1 }, target: 2 });
  assert.equal(planGoals(s, after).get('c2').route.steps[0].kind, 'warbond');
});
