import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { createSession } from '../src/logic/session.mjs';
import {
  newState, addChain, proposeChain, acceptRoute, reservations, evaluateAccepted, diffRoutes,
  proposeFleet, releaseChain, ConflictError,
} from '../src/logic/chains.mjs';

// Ladder: 1=$50, 2=$75, 3=$100, 4=$150, 5=$200
const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000 };
const standard = () => {
  const out = [];
  for (const f of [1, 2, 3, 4, 5]) for (const t of [1, 2, 3, 4, 5]) if (MSRP[t] > MSRP[f]) out.push({ from: f, to: t, kind: 'standard', cash: MSRP[t] - MSRP[f] });
  return out;
};
const copy = (copyId, from, to) => ({ copyId, from, to });

test('two chains, one copy: the first accepted keeps it, the second plans around it', () => {
  const owned = [copy('x', 2, 4)];
  const g = buildGraph({ offers: standard(), owned });
  const s = newState();
  const a = addChain(s, { name: 'A', base: 2, target: 4 });
  const b = addChain(s, { name: 'B', base: 2, target: 5 });
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  assert.equal(reservations(s).get('x'), a.id);
  const pb = proposeChain(s, b.id, g);
  assert.equal(pb.routes[0].cash, 12500, 'B pays standard 2->5');
  assert.ok(!pb.routes[0].steps.some((st) => st.copyId === 'x'));
  const fx = createSession({ plans: s, graph: g }).sharedEffect(b.id);
  assert.equal(fx.extra, 7500, 'B pays $75 more than on its own because A holds x');
  assert.deepEqual(fx.blockers.map((x) => x.goalId), [a.id]);
});

test('a second free copy of the same pair is used instead of reporting a blocker', () => {
  const g = buildGraph({ offers: standard(), owned: [copy('x1', 2, 4), copy('x2', 2, 4)] });
  const s = newState();
  const a = addChain(s, { base: 2, target: 4 });
  const b = addChain(s, { base: 2, target: 4 });
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  const pb = proposeChain(s, b.id, g);
  assert.equal(pb.routes[0].cash, 0);
  assert.equal(createSession({ plans: s, graph: g }).sharedEffect(b.id).extra, 0, 'a free copy of the pair gives the same route');
  acceptRoute(s, b.id, pb.routes[0]);
  assert.equal(new Set(reservations(s).values()).size, 2);
});

test('accepting a stale proposal that claims a taken copy is a conflict', () => {
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  const s = newState();
  const a = addChain(s, { base: 2, target: 4 });
  const b = addChain(s, { base: 2, target: 4 });
  // B planned alone (as if before A existed), so it claims x; shared planning would route B around A.
  const solo = newState();
  addChain(solo, { base: 2, target: 4 });
  const stale = proposeChain(solo, 'c1', g).routes[0];
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  assert.throws(() => acceptRoute(s, b.id, stale), ConflictError);
  assert.equal(s.chains[b.id].accepted, null, 'failed accept leaves B unchanged');
});

test('shared credit: two $35 purchases with $50 credit need $20 cash', () => {
  // 1->2 costs $25, 2->3 $25; use 1->3 = $50 standard per chain? Build exact $35 offers instead.
  const offers = [{ from: 1, to: 2, kind: 'standard', cash: 3500 }, { from: 3, to: 4, kind: 'standard', cash: 3500 }];
  const g = buildGraph({ offers });
  const s = newState();
  s.profile.credit = 5000;
  const a = addChain(s, { base: 1, target: 2 });
  const b = addChain(s, { base: 3, target: 4 });
  const ra = proposeChain(s, a.id, g).routes[0];
  assert.equal(ra.cash, 0);
  acceptRoute(s, a.id, ra);
  const pb = proposeChain(s, b.id, g);
  assert.equal(pb.credit, 1500, 'only uncommitted credit is visible');
  assert.equal(pb.routes[0].cash, 2000);
  const fleet = proposeFleet(s, g);
  assert.equal(fleet.totalCash, 2000);
});

test('refresh: removed copy blocks the accepted route, repricing is reported', () => {
  const owned = [copy('x', 1, 2)];
  const offers = [...standard(), { from: 2, to: 4, kind: 'warbond', cash: 2000 }];
  const g = buildGraph({ offers, owned });
  const s = newState();
  const a = addChain(s, { base: 1, target: 4 });
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  assert.equal(evaluateAccepted(s, a.id, { offers, owned }).status, 'ok');
  const repriced = offers.map((o) => (o.kind === 'warbond' ? { ...o, cash: 2500 } : o));
  const ev = evaluateAccepted(s, a.id, { offers: repriced, owned });
  assert.equal(ev.status, 'repriced');
  assert.equal(ev.cash, 2500);
  assert.equal(evaluateAccepted(s, a.id, { offers, owned: [] }).status, 'blocked');
  assert.equal(evaluateAccepted(s, a.id, { offers: standard(), owned }).status, 'blocked', 'warbond expired');
});

test('diff classifies unchanged, same path cheaper and alternative path', () => {
  const owned = [copy('x', 1, 2)];
  const offers = [...standard(), { from: 2, to: 4, kind: 'warbond', cash: 2000 }];
  const g = buildGraph({ offers, owned });
  const s = newState();
  const a = addChain(s, { base: 1, target: 4 });
  const acc = acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  assert.equal(diffRoutes(acc, proposeChain(s, a.id, g).routes[0]).kind, 'unchanged');
  const cheaper = buildGraph({ offers: offers.map((o) => (o.kind === 'warbond' ? { ...o, cash: 1500 } : o)), owned });
  const d1 = diffRoutes(acc, proposeChain(s, a.id, cheaper).routes[0]);
  assert.equal(d1.kind, 'same-path');
  assert.equal(d1.cashDelta, -500);
  const newCopy = buildGraph({ offers, owned: [...owned, copy('y', 1, 4)] });
  const d2 = diffRoutes(acc, proposeChain(s, a.id, newCopy).routes[0]);
  assert.equal(d2.kind, 'alternative');
  assert.deepEqual(d2.released, ['x']);
});

test('fleet proposal gives scarce copies to the higher priority chain', () => {
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  const s = newState();
  addChain(s, { name: 'low first', base: 2, target: 4, priority: 'low' });
  const high = addChain(s, { name: 'high', base: 2, target: 4, priority: 'high' });
  const f = proposeFleet(s, g);
  assert.equal(f.plans[0].chainId, high.id);
  assert.equal(f.plans[0].route.cash, 0);
  assert.equal(f.plans[1].route.cash, 7500);
  assert.equal(f.totalCash, 7500);
});

test('releasing a chain frees its copies and keeps history', () => {
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  const s = newState();
  const a = addChain(s, { base: 2, target: 4 });
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  releaseChain(s, a.id);
  assert.equal(reservations(s).size, 0);
  assert.equal(s.chains[a.id].history.length, 1);
});

// --- goal starts ---
import { startOf } from '../src/logic/chains.mjs';
import { tokenCopyId } from '../src/logic/tokens.mjs';

const tok = (pledgeId, ship, paidCents, msrpCents = 3000) => ({ pledgeId, ship, name: `S${ship}`, paidCents, msrpCents });

test('addChain stores start and no base', () => {
  const s = newState();
  const c = addChain(s, { target: 244, start: { kind: 'token' } });
  assert.deepEqual(c.start, { kind: 'token' });
  assert.equal('base' in c, false);
  assert.deepEqual(startOf(c), { kind: 'token' });
});

// --- shared planning: one token and one copy per goal ---
import { goalStarts, planGoals, startShip } from '../src/logic/chains.mjs';
import { issueLine } from '../src/logic/describe.mjs';

const tokenGraph = (lti, extra = {}) => buildGraph({ offers: standard(), lti, ...extra });
const tokenGoal = (s, target, extra = {}) => addChain(s, { start: { kind: 'token' }, target, ...extra });

test('three Pulse tokens, four goals: three distinct tokens, the lowest priority gets noToken', () => {
  const lti = [tok('1', 1, 3000), tok('2', 1, 3500), tok('3', 1, 4000)];
  const g = tokenGraph(lti);
  const s = newState();
  const a = tokenGoal(s, 2, { priority: 'high' });
  const b = tokenGoal(s, 3);
  const c = tokenGoal(s, 4);
  const d = tokenGoal(s, 5, { priority: 'low' });
  const plan = planGoals(s, g);
  const ids = [a, b, c].map((x) => plan.get(x.id).route.start.token.pledgeId);
  assert.equal(new Set(ids).size, 3);
  assert.equal(plan.get(d.id).route, null);
  assert.equal(plan.get(d.id).noToken, true);
  assert.equal(proposeChain(s, d.id, g).noToken, true);
  assert.deepEqual(proposeChain(s, d.id, g).routes, []);
  assert.equal(plan.get(a.id).noToken, false);
});

test('an accepted goal keeps its token against a higher-priority unaccepted goal', () => {
  const g = tokenGraph([tok('1', 1, 3000)]);
  const s = newState();
  const low = tokenGoal(s, 3, { priority: 'low' });
  acceptRoute(s, low.id, proposeChain(s, low.id, g).routes[0]);
  assert.equal(s.chains[low.id].accepted.token.pledgeId, '1');
  assert.equal(reservations(s).get(tokenCopyId('1')), low.id);
  const high = tokenGoal(s, 2, { priority: 'high' });
  const p = proposeChain(s, high.id, g);
  assert.equal(p.noToken, true);
  assert.deepEqual(p.routes, []);
});

test('two goals needing one owned copy: the higher priority uses it, the other pays', () => {
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  const s = newState();
  const low = addChain(s, { base: 2, target: 4, priority: 'low' });
  const high = addChain(s, { base: 2, target: 4, priority: 'high' });
  const plan = planGoals(s, g);
  assert.equal(plan.get(high.id).route.cash, 0);
  assert.equal(plan.get(low.id).route.cash, 7500);
  assert.ok(plan.get(low.id).exclude.has('x'));
  assert.ok(!plan.get(high.id).exclude.has('x'));
  assert.equal(proposeChain(s, low.id, g).routes[0].cash, 7500, 'proposeChain sees the same shared plan');
  assert.equal(proposeChain(s, high.id, g).routes[0].cash, 0);
});

test('proposeFleet total is the sum of the shared routes', () => {
  const g = tokenGraph([tok('1', 1, 3000), tok('2', 1, 3500)], { owned: [copy('x', 2, 4)] });
  const s = newState();
  tokenGoal(s, 4);
  tokenGoal(s, 5);
  addChain(s, { base: 2, target: 4 });
  const f = proposeFleet(s, g);
  const sum = f.plans.reduce((n, p) => n + (p.route?.cash ?? 0), 0);
  assert.equal(f.totalCash, sum);
  const tokens = f.plans.map((p) => p.route?.start?.token?.pledgeId).filter(Boolean);
  assert.equal(new Set(tokens).size, tokens.length);
});

test('proposeFleet reports an accepted goal by its accepted route', () => {
  const g = tokenGraph([tok('1', 1, 3000)]);
  const s = newState();
  const a = tokenGoal(s, 3);
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  const f = proposeFleet(s, g);
  assert.equal(f.plans[0].route.cash, s.chains[a.id].accepted.cash);
  assert.equal(f.plans[0].route.start.token.pledgeId, '1');
});

test('acceptRoute throws a ConflictError when the token is reserved elsewhere', () => {
  const g = tokenGraph([tok('1', 1, 3000)]);
  const s = newState();
  const a = tokenGoal(s, 2);
  const b = tokenGoal(s, 3);
  const stale = searchForToken(g, 3);
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  assert.throws(() => acceptRoute(s, b.id, stale), (e) => e instanceof ConflictError && /token already used by c1/.test(e.message));
  assert.equal(s.chains[b.id].accepted, null);
});
function searchForToken(g, target) {
  const s = newState();
  const c = tokenGoal(s, target);
  return proposeChain(s, c.id, g).routes[0];
}

test('evaluateAccepted: the token pledge missing from lti blocks with token-gone', () => {
  const lti = [tok('1', 1, 3000)];
  const g = tokenGraph(lti);
  const s = newState();
  const a = tokenGoal(s, 2);
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  const offers = standard();
  assert.equal(evaluateAccepted(s, a.id, { offers, owned: [], lti }).status, 'ok');
  const ev = evaluateAccepted(s, a.id, { offers, owned: [], lti: [] });
  assert.equal(ev.status, 'blocked');
  assert.ok(ev.issues.some((i) => i.kind === 'token-gone' && i.pledgeId === '1'));
  const gone = ev.issues.find((i) => i.kind === 'token-gone');
  assert.ok(ev.issues.every((i) => typeof i === 'object'), 'issues are objects, never strings');
  assert.equal(issueLine(gone, { name: (id) => `Ship${id}`, goalName: (id) => id }), 'Starting ship Ship1 no longer in the hangar');
  assert.equal(evaluateAccepted(s, a.id, { offers, owned: [] }).status, 'ok', 'no lti given: skip the check');
});

test('an empty pool gives noToken and no throw', () => {
  const g = tokenGraph([]);
  const s = newState();
  const a = tokenGoal(s, 2);
  const p = proposeChain(s, a.id, g);
  assert.equal(p.noToken, true);
  assert.deepEqual(p.routes, []);
  assert.equal(planGoals(s, g).get(a.id).noToken, true);
  assert.deepEqual(proposeFleet(s, g).unreachable, [a.id]);
});

test('a fixed-start goal is unaffected by tokens and has noToken false', () => {
  const g = tokenGraph([tok('1', 1, 3000)]);
  const s = newState();
  const a = addChain(s, { base: 2, target: 4 });
  const p = proposeChain(s, a.id, g);
  assert.equal(p.noToken, false);
  assert.equal(p.routes[0].cash, 7500);
  assert.equal(p.routes[0].start.token, null);
  assert.deepEqual(goalStarts(s, s.chains[a.id], g, new Set()), [{ ship: 2 }]);
});

test('goalStarts: any token gives the cheapest unexcluded pledge per ship type, a specific token its own entry', () => {
  const lti = [tok('1', 1, 3000), tok('2', 1, 3500), tok('3', 2, 4000)];
  const g = tokenGraph(lti);
  const s = newState();
  const any = tokenGoal(s, 5);
  const one = addChain(s, { start: { kind: 'token', pledgeId: '2' }, target: 5 });
  const pick = (st) => st.map((x) => [x.ship, x.token.pledgeId]);
  assert.deepEqual(pick(goalStarts(s, any, g, new Set())), [[1, '1'], [2, '3']]);
  assert.deepEqual(pick(goalStarts(s, any, g, new Set([tokenCopyId('1')]))), [[1, '2'], [2, '3']]);
  assert.deepEqual(pick(goalStarts(s, one, g, new Set())), [[1, '2']]);
  assert.deepEqual(goalStarts(s, one, g, new Set([tokenCopyId('2')])), []);
});

test('planGoals is memoised by content, not identity', () => {
  const g = tokenGraph([tok('1', 1, 3000)]);
  const s = newState();
  const a = tokenGoal(s, 2);
  const r1 = planGoals(s, g);
  assert.equal(planGoals(s, g), r1);
  s.chains[a.id].target = 3; // in place, as the CLI does
  const r2 = planGoals(s, g);
  assert.notEqual(r2, r1);
  assert.equal(r2.get(a.id).route.steps.at(-1).to, 3);
});

test('proposeFleet with ids reports the credit left after the whole shared plan', () => {
  const g = buildGraph({ offers: [{ from: 1, to: 2, kind: 'standard', cash: 3000 }, { from: 3, to: 4, kind: 'standard', cash: 2000 }] });
  const s = newState();
  s.profile.credit = 4000;
  const a = addChain(s, { base: 1, target: 2 });
  const b = addChain(s, { base: 3, target: 4 });
  const f = proposeFleet(s, g, { ids: [b.id] });
  assert.deepEqual(f.plans.map((p) => p.chainId), [b.id]);
  assert.equal(f.creditLeft, 0, 'a uses 3000 and b 1000 of the 4000');
  assert.equal(f.totalCash, 1000);
  assert.ok(a);
});

test('an accepted token goal pins its accepted token: proposal and goalStarts use that pledge only', () => {
  const g = tokenGraph([tok('1', 1, 3000), tok('2', 1, 2000)]);
  const s = newState();
  const a = tokenGoal(s, 3);
  acceptRoute(s, a.id, proposeChain(s, a.id, g).routes[0]);
  const held = s.chains[a.id].accepted.token.pledgeId;
  const other = held === '1' ? '2' : '1';
  assert.deepEqual(goalStarts(s, s.chains[a.id], g, new Set()).map((x) => [x.ship, x.token.pledgeId]), [[1, held]]);
  const p = proposeChain(s, a.id, g);
  assert.equal(p.routes[0].start.token.pledgeId, held);
  assert.notEqual(p.routes[0].start.token.pledgeId, other);
  assert.equal(startShip(s.chains[a.id], s.chains[a.id].accepted), 1);
});

test('an accepted route: "still valid" with a cheaper different route says so with both numbers; a repriced step gives its new cost', async () => {
  const { setup } = await import('./support/ladder.mjs');
  const { acceptRoute, evaluateAccepted, diffRoutes } = await import('../src/logic/goals.mjs');
  const { sessionFor } = await import('../src/logic/session.mjs');
  const { buildGraph } = await import('../src/logic/planner.mjs');
  const { acceptedStatusLine } = await import('../src/logic/describe.mjs');
  const { app, ids: [a] } = setup({ goals: [{ base: 1, target: 3 }] });
  acceptRoute(app.plans, a, sessionFor(app).shared.get(a).route);
  const acc = app.plans.chains[a].accepted;
  // B: its own steps keep their price, but another route is cheaper now.
  const offers = [...app.data.offers, { from: 1, to: 2, kind: 'warbond', cash: 1000, skuId: 9 }];
  const app2 = { ...app, data: { ...app.data, offers }, graph: buildGraph({ offers, owned: [] }), expected: offers };
  const ev = evaluateAccepted(app2.plans, a, { offers, owned: [], lti: [] });
  const best = sessionFor(app2).proposal(a, 1).routes[0];
  assert.equal(ev.status, 'ok');
  assert.equal(ev.cash, acc.cash);
  const line = acceptedStatusLine({ status: ev.status, acceptedCash: acc.cash, nowCash: ev.cash, bestCash: best.cash, differs: diffRoutes(acc, best).kind !== 'unchanged' });
  assert.equal(line.text, 'Still valid: everything it holds is still there at the same price.');
  assert.doesNotMatch(line.text, /proposed chain needs/i, 'the cheaper-chain fact is said once, by the banner');
  assert.deepEqual(line.better, { cash: 3500 });
  // Same cash on a different route: no "cheaper".
  assert.equal(acceptedStatusLine({ status: 'ok', acceptedCash: 5000, nowCash: 5000, bestCash: 5000, differs: true }).better, null);
  // A: the accepted step itself got cheaper.
  const offersA = app.data.offers.map((o) => (o.from === 1 && o.to === 3 ? { ...o, cash: 4000 } : o));
  const evA = evaluateAccepted(app.plans, a, { offers: offersA, owned: [], lti: [] });
  assert.equal(evA.status, 'repriced');
  assert.equal(acceptedStatusLine({ status: evA.status, acceptedCash: acc.cash, nowCash: evA.cash, bestCash: 4000, differs: false }).text, 'Still possible. Its steps now cost $40 instead of the $50 you reserved it at.');
  assert.equal(acceptedStatusLine({ status: 'repriced', acceptedCash: 5000, nowCash: 6000 }).text, 'Still possible, but its steps now cost $60 instead of the $50 you reserved it at.');
});
