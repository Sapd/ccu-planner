import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { createSession } from '../src/logic/session.mjs';
import { neededBecause } from '../src/logic/sharedEffect.mjs';
import { sharedEffectLine, neededBecauseText, goalCostText, blockerText } from '../src/logic/describe.mjs';

// Ladder: 1=$50, 2=$75, 3=$100, 4=$150, 5=$200
const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000 };
const NAMES = { 1: 'Pulse', 2: 'Hercules', 3: 'Carrack', 4: 'Liberator', 5: 'Ironclad' };
const ships = new Map(Object.entries(MSRP).map(([id, msrp]) => [Number(id), { id: Number(id), name: NAMES[id], msrp, concept: false }]));
const standard = () => {
  const out = [];
  for (const f of [1, 2, 3, 4, 5]) for (const t of [1, 2, 3, 4, 5]) if (MSRP[t] > MSRP[f]) out.push({ from: f, to: t, kind: 'standard', cash: MSRP[t] - MSRP[f] });
  return out;
};
const copy = (copyId, from, to) => ({ copyId, from, to, paid: { cents: 100 } });
const name = (id) => NAMES[id];

function setup({ owned = [], lti, offers = standard(), credit = 0, goals }) {
  const plans = newState();
  plans.profile.credit = credit;
  const ids = goals.map((g) => addChain(plans, g).id);
  const graph = buildGraph({ offers, owned, lti, ships });
  const session = createSession({ plans, graph, data: { ships, offers, owned, lti: lti ?? [] } });
  return { plans, session, ids };
}

test('a goal planned after another that takes the owned CCU its alone route uses pays more and names that goal', () => {
  // Liberator-like: B (high) takes the owned Hercules -> Liberator CCU; A (normal) would use it alone.
  const { session, ids: [a, b] } = setup({
    owned: [copy('x', 2, 4)],
    goals: [{ base: 2, target: 4 }, { base: 2, target: 5, priority: 'high' }],
  });
  const fx = session.sharedEffect(a);
  assert.equal(fx.alone.cash, 0);
  assert.equal(fx.shared.cash, 7500);
  assert.equal(fx.extra, 7500);
  assert.deepEqual(fx.blockers, [{ goalId: b, goalName: 'Ironclad', items: [{ kind: 'copy', from: 2, to: 4 }] }]);
  assert.equal(sharedEffectLine(fx, { name }), '$75 more than on its own: Ironclad uses your Hercules → Liberator CCU.');
  assert.equal(session.sharedEffect(a), fx, 'cached');
  // B planned first: sharing costs it nothing.
  const fb = session.sharedEffect(b);
  assert.equal(fb.extra, 0);
  assert.deepEqual(fb.blockers, []);
  assert.equal(sharedEffectLine(fb, { name }), null);
});

test('equal costs: extra 0 and no blockers, and nothing extra on the goal card', () => {
  const { session, ids: [a] } = setup({ owned: [copy('x', 2, 4)], goals: [{ base: 2, target: 4 }, { base: 1, target: 3 }] });
  const fx = session.sharedEffect(a);
  assert.equal(fx.extra, 0);
  assert.deepEqual(fx.blockers, []);
  assert.equal(goalCostText(fx.shared.cash, fx.alone.cash), '$0');
  assert.equal(goalCostText(7500, 0), '$75 · alone $0');
  assert.equal(goalCostText(null, null), null);
});

test('a second free copy of the pair is no blocker', () => {
  const { session, ids: [a] } = setup({ owned: [copy('x1', 2, 4), copy('x2', 2, 4)], goals: [{ base: 2, target: 4 }, { base: 2, target: 4 }] });
  assert.equal(session.sharedEffect(a).extra, 0);
  assert.deepEqual(session.sharedEffect(a).blockers, []);
});

test('a token blocker: another goal holds the LTI token the alone route would use', () => {
  // Tokens: Pulse (1) and Hercules (2). With no direct Hercules -> Liberator upgrade, Hercules still reaches
  // Liberator cheapest ($75 via Carrack; Pulse needs $100). The high goal takes the Hercules token, the other gets Pulse.
  const lti = [{ pledgeId: '11', ship: 1, name: 'Pulse', paidCents: 1000, msrpCents: 5000 }, { pledgeId: '12', ship: 2, name: 'Hercules', paidCents: 6000, msrpCents: 7500 }];
  const offers = standard().filter((o) => !(o.from === 2 && o.to === 4)); // a Hercules token has no cheap way to Liberator
  const { session, ids: [low, high] } = setup({
    lti, offers,
    goals: [{ start: { kind: 'token' }, target: 4 }, { start: { kind: 'token' }, target: 4, priority: 'high' }],
  });
  const fx = session.sharedEffect(low);
  assert.ok(fx.extra > 0, `extra ${fx.extra}`);
  assert.deepEqual(fx.blockers, [{ goalId: high, goalName: 'Liberator', items: [{ kind: 'token', from: 2, to: null }] }]);
  assert.equal(fx.extra, 2500);
  assert.match(sharedEffectLine(fx, { name }), /Liberator uses your Hercules \(starting ship\)\.$/);
});

test('a credit blocker: an earlier goal spent the store credit the alone route would use', () => {
  const offers = [{ from: 1, to: 2, kind: 'standard', cash: 3500 }, { from: 3, to: 4, kind: 'standard', cash: 3500 }];
  const { session, ids: [late, early] } = setup({
    offers, credit: 5000,
    goals: [{ base: 3, target: 4 }, { base: 1, target: 2, priority: 'high' }],
  });
  const fx = session.sharedEffect(late);
  assert.equal(fx.alone.cash, 0, 'alone, $50 credit pays the whole $35');
  assert.equal(fx.shared.cash, 2000);
  assert.equal(fx.extra, 2000);
  assert.deepEqual(fx.blockers, [{ goalId: early, goalName: 'Hercules', items: [{ kind: 'credit', from: null, to: null, amount: 2000 }] }]);
  assert.equal(blockerText(fx.blockers[0], { name }), 'Hercules uses $20 of your store credit');
});

test('accepted goals get the same: alone is their best route if nothing were reserved by others', async () => {
  const { session, plans, ids: [a, b] } = setup({ owned: [copy('x', 2, 4)], goals: [{ base: 2, target: 4 }, { base: 2, target: 5 }] });
  const { acceptRoute } = await import('../src/logic/chains.mjs');
  acceptRoute(plans, a, session.route(a)); // A takes x (created first, same level)
  const s2 = createSession({ plans, graph: session.graph, data: session.data });
  const fb = s2.sharedEffect(b);
  assert.equal(s2.sharedEffect(a).extra, 0, 'the accepted goal holds x and keeps its price');
  assert.equal(fb.alone.cash, 5000, 'alone: x, then Liberator -> Ironclad $50');
  assert.equal(fb.extra, fb.shared.cash - 5000);
  assert.ok(fb.extra > 0);
  assert.deepEqual(fb.blockers, [{ goalId: a, goalName: 'Liberator', items: [{ kind: 'copy', from: 2, to: 4 }] }]);
});

test('neededBecause names the blockers on a purchase the alone route does not make, and on nothing else', () => {
  const { session, ids: [a] } = setup({ owned: [copy('x', 2, 4)], goals: [{ base: 2, target: 4 }, { base: 2, target: 5, priority: 'high' }] });
  const fx = session.sharedEffect(a);
  const [buy] = fx.shared.steps;
  assert.equal(buy.kind, 'standard');
  const why = neededBecause(fx, buy);
  assert.deepEqual(why, fx.blockers);
  assert.equal(neededBecauseText(why, { name }), 'Needed because Ironclad uses your Hercules → Liberator CCU');
  // The same step in the alone route is not "needed because".
  assert.equal(neededBecause(fx, { kind: 'owned', from: 2, to: 4 }), null);
  assert.equal(neededBecause({ ...fx, alone: { steps: [buy] } }, buy), null);
  assert.equal(neededBecause({ ...fx, extra: 0 }, buy), null);
});

test('several blocking goals are all listed', () => {
  const owned = [copy('x', 2, 3), copy('y', 3, 4)];
  const { session, ids: [a] } = setup({
    owned,
    goals: [{ base: 2, target: 4 }, { base: 2, target: 3, priority: 'high' }, { base: 3, target: 5, priority: 'high' }],
  });
  const fx = session.sharedEffect(a);
  assert.equal(fx.blockers.length, 2);
  const text = neededBecauseText(fx.blockers, { name });
  assert.match(text, /^Needed because .* uses your Hercules → Carrack CCU and .* uses your Carrack → Liberator CCU$/);
});

test('levels lists goals by priority and, inside a level, in planning order', () => {
  const { session, ids: [n1, h1, l1, n2] } = setup({
    goals: [{ base: 1, target: 3 }, { base: 1, target: 4, priority: 'high' }, { base: 1, target: 5, priority: 'low' }, { base: 2, target: 5 }],
  });
  const levels = session.levels();
  assert.deepEqual(levels.map((l) => l.priority), ['high', 'normal', 'low']);
  assert.deepEqual(levels[0].ids, [h1]);
  assert.deepEqual(levels[2].ids, [l1]);
  assert.deepEqual([...levels[1].ids].sort(), [n1, n2].sort());
  assert.deepEqual(levels[1].ids, [...session.shared.keys()].filter((id) => [n1, n2].includes(id)), 'the order the shared plan chose');
});

test('Today: goal cards carry the cost and the alone cost, and the buy list says why a step is needed', async () => {
  const { todayView } = await import('../app/src/lib/view/today.mjs');
  const { emptyOverrides } = await import('../src/logic/prices.mjs');
  const { emptySaleEvents } = await import('../src/logic/availability.mjs');
  const { session, plans, ids: [a, b] } = setup({ owned: [copy('x', 2, 4)], goals: [{ base: 2, target: 4, mode: 'finish' }, { base: 2, target: 5, priority: 'high', mode: 'finish' }] });
  const offers = standard();
  const app = { data: { ships, offers, owned: [copy('x', 2, 4)], meta: { catalogAt: 'C', hangarAt: 'H' }, warbondPrices: null }, graph: session.graph, plans, overrides: emptyOverrides(), saleEvents: emptySaleEvents(), expected: offers };
  const v = todayView(app, '2026-11-18');
  const ga = v.goals.find((g) => g.goalId === a);
  const gb = v.goals.find((g) => g.goalId === b);
  assert.deepEqual([ga.cash, ga.aloneCash], [7500, 0]);
  assert.deepEqual([gb.cash, gb.aloneCash], [5000, null], 'equal: no alone cost');
  assert.equal(goalCostText(ga.cash, ga.aloneCash), '$75 · alone $0');
  const buy = v.buys.find((x) => x.goalId === a);
  assert.equal(buy.needed, 'Needed because Ironclad uses your Hercules → Liberator CCU');
  assert.equal(v.buys.find((x) => x.goalId === b)?.needed ?? null, null);
});

test('neededBecause is step-specific: each purchase names only the goal whose CCU it replaces', () => {
  // A's alone route: 1->2 Standard, owned 2->3 (x), 3->4 Standard, owned 4->5 (y). B takes x, C takes y.
  const { session, ids: [a, b, c] } = setup({
    offers: standard().filter((o) => o.to - o.from === 1),
    owned: [copy('x', 2, 3), copy('y', 4, 5)],
    goals: [{ base: 1, target: 5 }, { base: 2, target: 3, priority: 'high' }, { base: 4, target: 5, priority: 'high' }],
  });
  const fx = session.sharedEffect(a);
  assert.deepEqual(fx.blockers.map((x) => x.goalId).sort(), [b, c].sort());
  const key = (s) => `${s.from}-${s.to}`;
  const stepFor = (k) => fx.shared.steps.find((s) => key(s) === k);
  const one = (k) => neededBecause(fx, stepFor(k));
  assert.equal(one('1-2'), null, 'also in the alone route');
  assert.equal(one('3-4'), null, 'also in the alone route');
  assert.deepEqual(one('2-3'), [{ goalId: b, goalName: 'Carrack', items: [{ kind: 'copy', from: 2, to: 3 }] }]);
  assert.deepEqual(one('4-5'), [{ goalId: c, goalName: 'Ironclad', items: [{ kind: 'copy', from: 4, to: 5 }] }]);
  assert.equal(neededBecauseText(one('2-3'), { name }), 'Needed because Carrack uses your Hercules → Carrack CCU');
});

test('neededBecause: the token belongs to the first step, credit to the purchases beyond the remaining credit', () => {
  const lti = [{ pledgeId: '11', ship: 1, name: 'Pulse', paidCents: 1000, msrpCents: 5000 }, { pledgeId: '12', ship: 2, name: 'Hercules', paidCents: 6000, msrpCents: 7500 }];
  const offers = standard().filter((o) => o.to - o.from === 1);
  const t = setup({ lti, offers, goals: [{ start: { kind: 'token' }, target: 4 }, { start: { kind: 'token' }, target: 4, priority: 'high' }] });
  const fx = t.session.sharedEffect(t.ids[0]);
  const [first, second] = fx.shared.steps;
  assert.equal(neededBecause(fx, first)?.[0].items[0].kind, 'token');
  assert.equal(neededBecause(fx, second), null, 'the later step is in the alone route too');
  // Credit: two $35 purchases; the early goal spends $20... the late goal's Standard step pays cash.
  const c = setup({ offers: [{ from: 1, to: 2, kind: 'standard', cash: 3500 }, { from: 3, to: 4, kind: 'standard', cash: 3500 }], credit: 5000, goals: [{ base: 3, target: 4 }, { base: 1, target: 2, priority: 'high' }] });
  const cx = c.session.sharedEffect(c.ids[0]);
  assert.equal(neededBecause(cx, cx.shared.steps[0])[0].items[0].kind, 'credit', 'the step is in the alone route but pays cash because of the credit');
});

test('a goal with nothing taken and all credit left does not search again for its alone route', () => {
  const { session, ids: [a] } = setup({ goals: [{ base: 1, target: 3 }] });
  assert.equal(session.alone(a), session.route(a));
  assert.equal(session.sharedEffect(a).extra, 0);
});

test('accepted goals form their own first group; the other groups skip them', async () => {
  const { acceptRoute } = await import('../src/logic/chains.mjs');
  const { session, plans, ids: [n, h, l] } = setup({ goals: [{ base: 1, target: 3 }, { base: 1, target: 4, priority: 'high' }, { base: 1, target: 5, priority: 'low' }] });
  acceptRoute(plans, l, session.route(l));
  const s2 = createSession({ plans, graph: session.graph, data: session.data });
  assert.deepEqual(s2.levels().map((x) => [x.priority, x.ids]), [['accepted', [l]], ['high', [h]], ['normal', [n]]]);
});
