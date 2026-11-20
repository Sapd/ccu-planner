import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, acceptRoute, proposeChain, planGoals, proposeFleet } from '../src/logic/chains.mjs';

// Ladder: 1=$50, 2=$75, 3=$100, 4=$150, 5=$200 (cents)
const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000 };
const standard = () => {
  const out = [];
  for (const f of [1, 2, 3, 4, 5]) for (const t of [1, 2, 3, 4, 5]) if (MSRP[t] > MSRP[f]) out.push({ from: f, to: t, kind: 'standard', cash: MSRP[t] - MSRP[f] });
  return out;
};
const copy = (copyId, from, to) => ({ copyId, from, to });
// Goals get explicit, increasing creation times so the default order is the order they are added in.
let tick = 0;
const goal = (s, spec) => {
  const c = addChain(s, spec);
  c.createdAt = `2026-01-01T00:00:${String(tick++ % 60).padStart(2, '0')}Z`;
  return c;
};
const cashOf = (plan, ...ids) => ids.map((id) => plan.get(id).route?.cash ?? null);
const usesCopy = (plan, id, copyId) => plan.get(id).route.steps.some((s) => s.copyId === copyId);

// A (1->4) saves $5 with copy x (2->4: $25 + x vs a $30 offer); B (2->5) saves $75 with it.
const competing = (extra = {}) => {
  const g = buildGraph({ offers: [...standard(), { from: 1, to: 4, kind: 'standard', cash: 3000 }], owned: [copy('x', 2, 4)] });
  const s = newState();
  const a = goal(s, { base: 1, target: 4, ...extra.a });
  const b = goal(s, { base: 2, target: 5, ...extra.b });
  return { g, s, a, b };
};

test('same priority: the order that leaves both goals cheap wins over creation order', () => {
  const { g, s, a, b } = competing();
  const plan = planGoals(s, g);
  assert.deepEqual(cashOf(plan, b.id, a.id), [5000, 3000], 'B takes x ($50 left), A buys its $30 offer');
  assert.ok(usesCopy(plan, b.id, 'x'));
  assert.ok(!usesCopy(plan, a.id, 'x'));
  assert.deepEqual([...plan.keys()], [b.id, a.id], 'result lists goals in planning order');
  assert.ok(plan.get(a.id).exclude.has('x'), 'A saw x already claimed by B');
  assert.ok(!plan.get(b.id).exclude.has('x'));
  const fleet = proposeFleet(s, g);
  assert.equal(fleet.totalCash, 8000);
  assert.deepEqual(fleet.plans.map((p) => p.chainId), [b.id, a.id]);
  assert.equal(proposeChain(s, a.id, g).routes[0].cash, 3000, 'proposeChain agrees with the shared plan');
});

test('priority still wins, even when the other order is cheaper', () => {
  const { g, s, a, b } = competing({ a: { priority: 'high' } });
  const plan = planGoals(s, g);
  assert.ok(usesCopy(plan, a.id, 'x'), 'high goal A is planned first and takes x');
  assert.deepEqual(cashOf(plan, a.id, b.id), [2500, 12500], 'total 150 although B first would be 80');
  assert.deepEqual([...plan.keys()], [a.id, b.id]);
});

test('a goal never loses its route to save cash elsewhere', () => {
  // q (4->6) is the only way to ship 6 for B; A (3->6) can use q ($50 + q) or a $500 offer.
  const g = buildGraph({ offers: [...standard(), { from: 3, to: 6, kind: 'standard', cash: 50000 }], owned: [copy('q', 4, 6)] });
  const s = newState();
  const a = goal(s, { base: 3, target: 6 });
  const b = goal(s, { base: 4, target: 6 });
  const plan = planGoals(s, g);
  assert.deepEqual(cashOf(plan, b.id, a.id), [0, 50000], 'both routed: B gets q, A pays $500');
  assert.ok(usesCopy(plan, b.id, 'q'));
  // Default order alone would route one goal for $50.
  const only = newState();
  goal(only, { base: 3, target: 6 });
  assert.equal(planGoals(only, g).get('c1').route.cash, 5000);
});

test('ties keep creation order', () => {
  // A (2->4) and B (2->5) both save $75 with x: $125 either way.
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  const s = newState();
  const a = goal(s, { base: 2, target: 4 });
  const b = goal(s, { base: 2, target: 5 });
  const plan = planGoals(s, g);
  assert.ok(usesCopy(plan, a.id, 'x'));
  assert.deepEqual(cashOf(plan, a.id, b.id), [0, 12500]);
  assert.deepEqual([...plan.keys()], [a.id, b.id]);
});

test('accepted goals keep their claims and route', () => {
  // Accepted A holds x (2->4) although B and C would both prefer it.
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  const s = newState();
  const a = goal(s, { base: 2, target: 4 });
  const b = goal(s, { base: 2, target: 5 });
  const c = goal(s, { base: 2, target: 5 });
  const before = planGoals(s, g).get(a.id).route;
  assert.ok(before.steps.some((st) => st.copyId === 'x'));
  acceptRoute(s, a.id, before);
  const acceptedSteps = structuredClone(s.chains[a.id].accepted.steps);
  const plan = planGoals(s, g);
  assert.deepEqual(plan.get(a.id).route.steps, acceptedSteps);
  assert.equal(plan.get(a.id).route.cash, 0);
  assert.ok(!plan.get(a.id).exclude.has('x'), 'A does not exclude its own copy');
  for (const id of [b.id, c.id]) {
    assert.ok(plan.get(id).exclude.has('x'), 'others see x claimed');
    assert.ok(!usesCopy(plan, id, 'x'));
    assert.equal(plan.get(id).route.cash, 12500);
  }
});

test('levels are independent: low goals see what the normal level chose', () => {
  const { g, s, a, b } = competing();
  const low = goal(s, { base: 2, target: 5, priority: 'low' });
  const plan = planGoals(s, g);
  assert.ok(usesCopy(plan, b.id, 'x'));
  assert.equal(plan.get(low.id).route.cash, 12500);
  assert.deepEqual([...plan.keys()], [b.id, a.id, low.id]);
});

test('deterministic and memoised', () => {
  const { g, s } = competing();
  const r1 = planGoals(s, g);
  assert.equal(planGoals(s, g), r1);
  const snap = (plan) => [...plan].map(([id, x]) => [id, [...x.exclude].sort(), x.credit, x.noToken, x.route?.cash, x.route?.steps.map((st) => [st.kind, st.from, st.to, st.copyId ?? null])]);
  const again = planGoals(structuredClone(s), buildGraph({ offers: [...standard(), { from: 1, to: 4, kind: 'standard', cash: 3000 }], owned: [copy('x', 2, 4)] }));
  assert.deepEqual(snap(again), snap(r1));
});

// Seeded fuzz: invariants of the chosen plan, and result reuse changes nothing.
test('random goal sets: no double claims, credit never overspent, reuse is exact', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const ri = (n) => Math.floor(rnd() * n);
  const snap = (plan) => JSON.stringify([...plan].map(([id, x]) => [id, [...x.exclude].sort(), x.credit, x.noToken, x.route && [x.route.cash, x.route.creditUsed, x.route.allIn, x.route.start?.token?.copyId ?? null, x.route.steps.map((st) => [st.kind, st.from, st.to, st.copyId ?? null])]]));
  for (let it = 0; it < 200; it++) {
    const ns = 4 + ri(4);
    const offers = [];
    const owned = [];
    for (let f = 1; f <= ns; f++) for (let t = 1; t <= ns; t++) if (f !== t && rnd() < 0.5) offers.push({ from: f, to: t, kind: rnd() < 0.7 ? 'standard' : 'warbond', cash: (1 + ri(20)) * 500 });
    for (let i = 0, n = 2 + ri(8); i < n; i++) owned.push({ copyId: `o${i}`, from: 1 + ri(ns), to: 1 + ri(ns), paid: rnd() < 0.8 ? { cents: ri(10) * 500 } : null });
    const lti = [];
    for (let i = 0, n = ri(4); i < n; i++) lti.push({ pledgeId: `p${i}`, ship: 1 + ri(ns), name: 'x', paidCents: ri(8) * 500, msrpCents: 5000 });
    const mk = () => buildGraph({ offers, owned, lti });
    const s = newState();
    s.profile = { ...(s.profile ?? {}), credit: rnd() < 0.5 ? ri(12) * 500 : 0 };
    for (let n = 0, ng = 2 + ri(5); n < ng; n++) {
      const tok = lti.length && rnd() < 0.5;
      const c = goal(s, { start: tok ? { kind: 'token' } : { kind: 'ship', ship: 1 + ri(ns) }, target: 1 + ri(ns), priority: rnd() < 0.2 ? 'high' : 'normal' });
      if (rnd() < 0.3) c.objective = 'allin';
    }
    const plan = planGoals(structuredClone(s), mk());
    const claimed = new Set();
    let credit = 0;
    for (const x of plan.values()) {
      if (!x.route) continue;
      const ids = [...x.route.steps.map((st) => st.copyId), x.route.start?.token?.copyId].filter(Boolean);
      for (const id of ids) { assert.ok(!claimed.has(id), `case ${it}: ${id} claimed twice`); claimed.add(id); }
      assert.ok(x.route.creditUsed <= x.credit, `case ${it}: goal overspends its credit`);
      credit += x.route.creditUsed;
    }
    assert.ok(credit <= s.profile.credit, `case ${it}: total credit overspent`);
    // Same search effort for both (reuse saves searches, so a cap would let it try more orders): only reuse differs.
    const reused = planGoals(structuredClone(s), mk(), { searchCap: 1e9 });
    const fresh = planGoals(structuredClone(s), mk(), { searchCap: 1e9, noReuse: true });
    assert.equal(snap(reused), snap(fresh), `case ${it}: reuse changed the plan`);
  }
});
