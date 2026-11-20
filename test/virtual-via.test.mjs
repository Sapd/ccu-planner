import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, withVirtualCcus, searchRoutes, keepVirtual } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, acceptRoute, planGoals, evaluateAccepted } from '../src/logic/chains.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { planningGraph } from '../src/logic/session.mjs';
import { emptyOverrides } from '../src/logic/prices.mjs';

const ships = new Map([1, 2, 3, 4, 5].map((id) => [id, { id, name: `S${id}`, msrp: id * 5000, concept: false, owned: false, onSale: true }]));
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });
const wb = (from, to, cash) => ({ from, to, kind: 'warbond', cash });
const base = buildGraph({ offers: [std(1, 3, 10000), std(1, 2, 5000), std(2, 3, 5000), wb(1, 4, 4000), std(4, 3, 6000)], ships });
const doc = (plans) => ({ plans, overrides: emptyOverrides() });
const act = (plans, action) => applyAction(doc(plans), action, { ships });

const withVirtual = (list, goals = 1) => {
  let s = newState();
  for (let i = 0; i < goals; i++) addChain(s, { start: { kind: 'ship', ship: 1 }, target: 3 });
  for (const ccu of list) s = act(s, { type: 'setVirtualCcu', ccu }).plans;
  return s;
};

test('a virtual CCU is planned with as cash-only, at its price', () => {
  const s = withVirtual([{ from: 1, to: 3, cents: 3000 }]);
  const g = planningGraph(base, s, '2026-11-20');
  const r = proposeChain(s, 'c1', g, { k: 1 }).routes[0];
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].virtual, true);
  assert.equal(r.steps[0].copyId, 'virtual:v1:1-3:1');
  assert.equal(r.cash, 3000);
  assert.equal(r.warbondCash, 3000);
  assert.equal(r.ownedUsed, 0);
  // store credit cannot pay for it
  const credit = searchRoutes(g, { base: 1, target: 3, credit: 2000, maxResults: 1 })[0];
  assert.equal(credit.steps[0].virtual, true);
  assert.equal(credit.cash, 3000);
  assert.equal(credit.creditUsed, 0);
});

test('copies limit how many goals can use one virtual CCU', () => {
  const one = withVirtual([{ from: 1, to: 3, cents: 3000 }], 2);
  const plan1 = planGoals(one, planningGraph(base, one, '2026-11-20'));
  const virtualUses = (p) => [...p.values()].filter((e) => e.route?.steps.some((x) => x.virtual)).length;
  assert.equal(virtualUses(plan1), 1);
  const two = withVirtual([{ from: 1, to: 3, cents: 3000, copies: 2 }], 2);
  assert.equal(virtualUses(planGoals(two, planningGraph(base, two, '2026-11-20'))), 2);
});

test('an expired virtual CCU is not planned with; a deleted one stays in a reserved chain', () => {
  const s = withVirtual([{ from: 1, to: 3, cents: 3000, expires: '2026-11-19' }]);
  assert.equal(planningGraph(base, s, '2026-11-20'), base);
  assert.notEqual(planningGraph(base, s, '2026-11-19'), base);

  const t = withVirtual([{ from: 1, to: 3, cents: 3000 }]);
  const g = planningGraph(base, t, '2026-11-20');
  acceptRoute(t, 'c1', proposeChain(t, 'c1', g, { k: 1 }).routes[0], {}, { graph: g });
  const gone = act(t, { type: 'removeVirtualCcu', id: 'v1' }).plans;
  assert.equal(gone.chains.c1.accepted.steps[0].virtual, true);
  const ev = evaluateAccepted(gone, 'c1', { offers: [], owned: [] });
  assert.equal(ev.status, 'ok');
  assert.equal(ev.cash, 3000);
  const repriced = act(t, { type: 'setVirtualCcu', ccu: { id: 'v1', from: 1, to: 3, cents: 3500 } }).plans;
  const ev2 = evaluateAccepted(repriced, 'c1', { offers: [], owned: [] });
  assert.equal(ev2.status, 'repriced');
  assert.equal(ev2.cash, 3500);
});

test('setVirtualCcu validates its input and edits in place', () => {
  const s = withVirtual([]);
  assert.throws(() => act(s, { type: 'setVirtualCcu', ccu: { from: 1, to: 1, cents: 1 } }), /differ/);
  assert.throws(() => act(s, { type: 'setVirtualCcu', ccu: { from: 1, to: 99, cents: 1 } }), /known/);
  assert.throws(() => act(s, { type: 'setVirtualCcu', ccu: { from: 1, to: 2, cents: -1 } }), /price/);
  assert.throws(() => act(s, { type: 'setVirtualCcu', ccu: { from: 1, to: 2, cents: 1, copies: 0 } }), /copies/);
  assert.throws(() => act(s, { type: 'setVirtualCcu', ccu: { from: 1, to: 2, cents: 1, expires: '20.11.2026' } }), /YYYY-MM-DD/);
  assert.throws(() => act(s, { type: 'setVirtualCcu', ccu: { from: 1, to: 2, cents: 1, note: 'x'.repeat(101) } }), /100/);
  const a = act(s, { type: 'setVirtualCcu', ccu: { from: 1, to: 2, cents: 100, note: ' friend ' } });
  assert.deepEqual({ ...a.result, createdAt: null }, { id: 'v1', from: 1, to: 2, cents: 100, copies: 1, expires: null, note: 'friend', createdAt: null });
  const b = act(a.plans, { type: 'setVirtualCcu', ccu: { id: 'v1', from: 1, to: 2, cents: 200 } });
  assert.equal(b.plans.profile.virtualCcus.length, 1);
  assert.equal(b.plans.profile.virtualCcus[0].cents, 200);
});

test('rebuilt graphs (what-ifs, expected prices) keep the virtual edges', () => {
  const s = withVirtual([{ from: 1, to: 3, cents: 3000 }]);
  const g = planningGraph(base, s, '2026-11-20');
  const rebuilt = keepVirtual(g, buildGraph({ offers: [std(1, 3, 10000)], ships }));
  assert.equal(searchRoutes(rebuilt, { base: 1, target: 3, maxResults: 1 })[0].cash, 3000);
});

test('via: the route must pass through the chosen ship', () => {
  assert.equal(searchRoutes(base, { base: 1, target: 3, maxResults: 1 })[0].cash, 10000);
  const r = searchRoutes(base, { base: 1, target: 3, maxResults: 1, via: 4 })[0];
  assert.deepEqual(r.steps.map((x) => x.to), [4, 3]);
  assert.equal(r.cash, 10000);
  assert.equal(searchRoutes(base, { base: 1, target: 3, maxResults: 1, via: 2, credit: 0 })[0].steps.map((x) => x.to).join(), '2,3');
  // a via ship that cannot be reached on the way: no route
  assert.equal(searchRoutes(base, { base: 3, target: 4, maxResults: 1, via: 2 }).length, 0);
});

test('setVia plans the goal through the ship and releases a reservation that skips it', () => {
  let s = withVirtual([]);
  acceptRoute(s, 'c1', proposeChain(s, 'c1', base, { k: 1 }).routes[0], {}, { graph: base });
  const out = act(s, { type: 'setVia', chainId: 'c1', ship: 4 });
  assert.deepEqual(out.result, ['c1']);
  s = out.plans;
  assert.equal(s.chains.c1.via, 4);
  assert.equal(s.chains.c1.accepted, null);
  assert.deepEqual(proposeChain(s, 'c1', base, { k: 1 }).routes[0].steps.map((x) => x.to), [4, 3]);
  assert.throws(() => act(s, { type: 'setVia', chainId: 'c1', ship: 3 }), /target/);
  assert.throws(() => act(s, { type: 'setVia', chainId: 'c1', ship: 1 }), /start/);
  const cleared = act(s, { type: 'setVia', chainId: 'c1', ship: null }).plans;
  assert.equal('via' in cleared.chains.c1, false);
});

test('via: a cheaper prefix through other ships does not hide the only route back down', () => {
  // 1->2->4 is cheaper than 1->3->4, but the only way on from 4 goes back through 2 (an owned downward CCU).
  const owned = [{ copyId: 'd42', from: 4, to: 2, paid: { cents: 0 } }];
  const g = buildGraph({ offers: [std(1, 2, 100), std(2, 4, 100), std(1, 3, 500), std(3, 4, 500), std(2, 5, 100)], owned, ships });
  const r = searchRoutes(g, { base: 1, target: 5, via: 4, maxResults: 1 })[0];
  assert.deepEqual(r?.steps.map((x) => x.to), [3, 4, 2, 5]);
});

test('a stale route that skips the via ship cannot be reserved', () => {
  const s = act(withVirtual([]), { type: 'setVia', chainId: 'c1', ship: 4 }).plans;
  const skip = searchRoutes(base, { base: 1, target: 3, maxResults: 1 })[0];
  assert.throws(() => acceptRoute(s, 'c1', { ...skip, start: { ship: 1 } }, {}, { graph: base }), /route through/);
});

test('virtual records for the same pair are separate alternatives, and an edited pair keeps the reserved price', () => {
  const s = withVirtual([{ from: 1, to: 3, cents: 400 }, { from: 1, to: 3, cents: 600 }]);
  const g = planningGraph(base, s, '2026-11-20');
  const routes = proposeChain(s, 'c1', g, { k: 3 }).routes.map((r) => r.cash);
  assert.deepEqual(routes.slice(0, 2), [400, 600]);
  acceptRoute(s, 'c1', proposeChain(s, 'c1', g, { k: 1 }).routes[0], {}, { graph: g });
  const moved = act(s, { type: 'setVirtualCcu', ccu: { id: 'v1', from: 2, to: 4, cents: 4000 } }).plans;
  assert.equal(evaluateAccepted(moved, 'c1', { offers: [], owned: [] }).cash, 400);
});
