// End-to-end simulation: a fresh virtual account buys CCUs day after day, driven the way the UI drives the planner.
//
// The store (test/support/sim.mjs) is deterministic: ships, Standard upgrades for every pair, Warbonds that appear and vanish, a sale event,
// a concept ship that gets dearer, an event-only ship. The account starts with three cheap LTI starting ships, $60 store credit and no CCUs, and
// has four goals that compete for the same Warbonds and intermediate ships (test/support/sim-world.mjs). Every day it opens Today and buys by
// a written policy (test/support/sim-run.mjs, `patient`); the invariants are checked on the morning and the evening plan of every day while
// the simulation runs (checkInvariants), and the end state is checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGoals, proposeFleet } from '../src/logic/sharedPlan.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { buildGraph } from '../src/logic/planner.mjs';
import { goalRow } from '../app/src/lib/view/goalTable.mjs';
import { todayView } from '../app/src/lib/view/today.mjs';
import { sessionOf } from '../src/logic/session.mjs';
import { SPEC, GOALS, script, ORDER_SPEC, ORDER_GOALS } from './support/sim-world.mjs';
import { runSimulation, patient, impatient } from './support/sim-run.mjs';
import { todayOf, appOf, createWorld, newAccount, addGoal, isDoneRoute, assignChains } from './support/sim.mjs';
import { applyAction } from '../src/logic/state.mjs';

const memo = new Map();
const run = (name, make) => (memo.has(name) ? memo.get(name) : (memo.set(name, make()), memo.get(name)));
const patientRun = () => run('patient', () => runSimulation({ spec: SPEC, goals: GOALS, script, policy: patient }));
const impatientRun = () => run('impatient', () => runSimulation({ spec: SPEC, goals: GOALS, script, policy: impatient }));
const cents = (n) => `$${n / 100}`;

// ----- the main scenario -----

test('simulation: 45 days, four goals, the invariants hold on every morning and evening plan', () => {
  const r = patientRun(); // throws at the first broken invariant, naming the day
  assert.equal(r.rows.length, SPEC.days);
  // The scenario really exercises what it is for (so it cannot silently stop doing so):
  const bought = r.S.purchases;
  const on = (day) => r.rows[day].bought;
  assert.ok(bought.some((p) => p.kind === 'standard' && p.credit > 0), 'Standard steps are paid with credit first');
  assert.ok(bought.some((p) => p.kind === 'warbond' && p.credit === 0), 'Warbonds are paid with cash');
  assert.ok(bought.some((p) => p.kind === 'standard' && p.credit > 0 && p.cash > 0), 'a Standard step is paid half in credit, half in cash');
  assert.equal(r.S.stock.get(101), 0, 'the limited-stock Warbond is sold out, one copy went to one goal');
  assert.ok(r.rows.some((x) => x.notes.some((n) => n.startsWith('reserve'))), 'goals were reserved');
  assert.ok(r.rows.some((x) => x.notes.some((n) => n.startsWith('switch'))), 'a reservation was switched to a cheaper chain');
  assert.ok(r.rows.some((x) => x.notes.some((n) => n.startsWith('rebuild'))), 'a reservation was rebuilt after its offer went');
  assert.ok(r.rows.slice(0, 5).every((x) => x.status.c3 === 'no-route'), 'the event-only target has no route before the event');
  assert.ok(r.firstAnnounced.get('c3').day >= 5, 'its goal is first announced when the event begins');
  assert.deepEqual(r.trace.increases.map((x) => [x.day, x.goal, x.causes[0].code]), [[23, 'c2', 'offer-gone']], 'the one dearer plan is the Warbond that left without notice');
});

test('simulation: no copy and no starting ship is used by two goals, credit only buys Standard steps (invariants 1 and 2, final state)', () => {
  const { S } = patientRun();
  // Every owned copy is walked once: copies are consumed by exactly one goal's chain.
  const final = assignChains(S);
  assert.ok(final, 'the owned copies and starting ships can be divided into one chain per goal');
  const copies = [...final.values()].flatMap((c) => c.copies);
  assert.equal(new Set(copies).size, copies.length, 'no copy is in two chains');
  const tokens = [...final.values()].map((c) => c.token).filter(Boolean);
  assert.equal(new Set(tokens).size, tokens.length, 'no starting ship is used by two goals');
  for (const p of S.purchases) {
    assert.ok(p.kind === 'standard' || p.credit === 0, 'credit never pays a Warbond');
    assert.equal(p.credit + p.cash, p.price);
  }
  assert.equal(S.plans.profile.credit + S.spent.credit, S.creditIn, 'the credit adds up');
  assert.ok(S.plans.profile.credit >= 0);
});

test('simulation: at the end every goal is complete, Today buys nothing and Goals shows nothing left to pay (invariant 6)', () => {
  const { S, rows, ids } = patientRun();
  const { view, app } = todayOf(S, SPEC.days - 1);
  const chains = assignChains(S);
  assert.ok(chains, 'every goal owns a chain of copies from its starting ship to its target');
  for (const id of ids) {
    const c = S.plans.chains[id];
    const chain = chains.get(id);
    assert.ok(chain.copies.length > 0, `${id} owns upgrades`);
    assert.equal(chain.target, c.target, `${id}'s chain ends at its target`);
    assert.ok(isDoneRoute(sessionOf(app).route(id)), `${id}: the planner's route is all owned copies`);
  }
  assert.equal(view.buys.length, 0, 'Today lists nothing to buy');
  assert.equal(view.hero.nothingWhy, 'all-owned');
  assert.deepEqual(view.goals.map((g) => g.status), ids.map(() => 'done'));
  assert.deepEqual(view.goals.map((g) => goalRow(g).left), ids.map(() => 0), 'Goals: 0 left to pay');
  assert.equal(S.world.spec, SPEC);
  assert.deepEqual(rows.at(-1).status, Object.fromEntries(ids.map((id) => [id, 'done'])));
});

test('simulation: money. What was paid never exceeds what the planner announced plus the dearer plans it can name (invariant 4)', () => {
  // Honest version of "total cash <= the day-0 announcement". The planner cannot announce goals that have no route yet (c3 has none until the
  // event), and a sale that ends without notice makes the plan dearer. So the bound is: every goal's first announcement + every overnight
  // increase of a goal's announced cash, each of which checkInvariants only lets through when an offer of that goal's own route left or rose.
  // Buying itself never makes the plan dearer (checked every evening: the plan after buying needs at most what it needed minus the cash paid),
  // so the plan's cash telescopes: paid = announced + overnight changes + savings, and savings are not negative.
  const { S, firstAnnounced, trace } = patientRun();
  const announced = [...firstAnnounced.values()].reduce((n, x) => n + x.cash, 0);
  const increases = trace.increases.reduce((n, x) => n + (x.now - x.was), 0);
  assert.ok(S.spent.cash <= announced + increases, `paid ${cents(S.spent.cash)}, announced ${cents(announced)} + dearer ${cents(increases)}`);
  // And on day 0 in particular: what was announced for the goals that had a route.
  const day0 = [...firstAnnounced.values()].filter((x) => x.day === 0).reduce((n, x) => n + x.cash, 0);
  assert.ok(S.spent.cash <= day0 + (announced - day0) + increases);
});

test('simulation: waiting for sales never costs more than buying everything at once (invariant 5)', () => {
  const p = patientRun().S.spent.cash;
  const i = impatientRun().S.spent.cash;
  assert.ok(p <= i, `patient paid ${cents(p)}, impatient ${cents(i)}`);
  assert.ok(i - p >= 5000, 'and the patience was worth something here');
  // The impatient user finishes the same goals.
  const { S } = impatientRun();
  assert.ok(assignChains(S), 'the impatient account owns every goal too');
});

test('simulation: it is deterministic', () => {
  const again = runSimulation({ spec: SPEC, goals: GOALS, script, policy: patient });
  const key = (r) => r.S.purchases.map((p) => `${p.day}:${p.goalId}:${p.kind}:${p.from}-${p.to}:${p.cash}/${p.credit}`).join('|');
  assert.equal(key(again), key(patientRun()));
});

// ----- the ordering scenario -----

test('ordering: the shared plan is never dearer than planning the goals one after the other in the cheaper order', () => {
  const world = createWorld(ORDER_SPEC);
  const total = (priorities) => {
    const S = newAccount(ORDER_SPEC, world);
    ORDER_GOALS.forEach((g, n) => addGoal(S, { ...g, priority: priorities[n] }));
    const app = appOf(S, 0);
    return { totalCash: proposeFleet(S.plans, app.graph).totalCash, plan: planGoals(S.plans, app.graph) };
  };
  const aFirst = total(['high', 'normal']).totalCash; // A planned before B
  const bFirst = total(['normal', 'high']).totalCash; // B planned before A
  assert.deepEqual([aFirst, bFirst], [6000, 4500], 'the order matters in this world');
  const shared = total(['normal', 'normal']); // equal priority: the planner chooses the order
  assert.equal(shared.totalCash, Math.min(aFirst, bFirst), 'the shared plan found the cheaper order');
  assert.ok(shared.totalCash <= Math.min(aFirst, bFirst));
  const routes = [...shared.plan.values()].map((e) => e.route);
  const copies = routes.flatMap((r) => r.steps.filter((s) => s.copyId).map((s) => s.copyId));
  assert.equal(new Set(copies).size, copies.length, 'and nothing is used twice');
});

test('ordering: bought step by step, the account pays what the cheaper order announced', () => {
  const r = runSimulation({ spec: ORDER_SPEC, goals: ORDER_GOALS, script: {}, policy: patient });
  assert.equal(r.S.spent.cash, 4500);
  assert.ok(assignChains(r.S));
});

// ----- what the simulation showed (both were app gaps, now fixed) -----

test('a reservation whose Standard step was bought with the credit it held keeps that credit committed', () => {
  const ships = new Map([[1, { id: 1, name: 'A', msrp: 1000 }], [2, { id: 2, name: 'B', msrp: 3500 }], [3, { id: 3, name: 'C', msrp: 4500 }], [4, { id: 4, name: 'D', msrp: 5500 }]]);
  const offers = [{ from: 1, to: 2, kind: 'standard', cash: 2500 }, { from: 3, to: 4, kind: 'standard', cash: 1000 }];
  const sessionFor = (plans, owned) => sessionOf({ plans, graph: buildGraph({ offers, owned, ships }), data: { ships, offers, owned }, overrides: { rev: 0, ships: {} }, saleEvents: { rev: 0, events: [] }, expected: offers });
  const plans = newState();
  plans.profile.credit = 4000;
  addChain(plans, { start: { kind: 'ship', ship: 1 }, target: 2 }); // c1: $25 Standard, reserved
  addChain(plans, { start: { kind: 'ship', ship: 3 }, target: 4 }); // c2: $10 Standard
  let doc = { plans, overrides: { rev: 0, ships: {} } };
  doc = applyAction(doc, { type: 'accept', chainId: 'c1', route: sessionFor(doc.plans, []).route('c1') });
  assert.equal(doc.plans.chains.c1.accepted.creditUsed, 2500);
  // c1 buys its step with the credit it held: 2500 of 4000 is spent, 1500 is left, and c1's copy is owned.
  doc.plans.profile.credit = 1500;
  const owned = [{ copyId: 'k1', from: 1, to: 2, paid: { cents: 2500 } }];
  const after = sessionFor(doc.plans, owned);
  assert.equal(after.route('c2').creditUsed, 1000, 'the credit that is left is free for the other goal');
  assert.equal(after.route('c2').cash, 0);
});

test('a goal in finish mode ("get it as soon as possible") lists its purchases under Buy now, and Today does not say there is nothing to buy', () => {
  const ships = new Map([[1, { id: 1, name: 'A', msrp: 1000, standard: true }], [2, { id: 2, name: 'B', msrp: 3000, standard: true }]]);
  const offers = [{ from: 1, to: 2, kind: 'warbond', cash: 1500, skuId: 7 }, { from: 1, to: 2, kind: 'standard', cash: 2000 }];
  const plans = newState();
  addChain(plans, { start: { kind: 'ship', ship: 1 }, target: 2, mode: 'finish' });
  const app = { data: { ships, offers, owned: [], meta: { catalogAt: 'C', hangarAt: 'H', limitedShare: { warbond: 0, standard: 0 } }, warbondPrices: null, saleHistory: null }, graph: buildGraph({ offers, owned: [], ships }), plans, overrides: { rev: 0, ships: {} }, saleEvents: { rev: 0, events: [] }, expected: offers };
  const view = todayView(app, '2026-11-20');
  assert.equal(view.buys.length, 1, 'the goal has a purchase to make now');
  assert.equal(view.hero.nothing, false, 'so Today does not say there is nothing to buy');
});
