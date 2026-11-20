import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, expectedChanges, planGoals, acceptRoute, setObjective } from '../src/logic/chains.mjs';
import { routeAdvice } from '../src/logic/advice.mjs';
import { journey } from '../src/logic/journey.mjs';
import { availCtx } from '../src/logic/availability.mjs';
import { emptyOverrides } from '../src/logic/prices.mjs';
import { emptySaleEvents } from '../src/logic/availability.mjs';
import { todayView } from '../app/src/lib/view/today.mjs';
import { createSession } from '../src/logic/session.mjs';

// 1 = start, 2 = B (cheap bridge), 3 = C (alternative bridge), 4 = target.
const NAMES = { 1: 'Start', 2: 'Bridge', 3: 'Other', 4: 'Target' };
const ships = new Map([1, 2, 3, 4].map((id) => [id, { id, name: NAMES[id], msrp: id * 5000, concept: false, owned: false, onSale: true }]));
const name = (id) => NAMES[id];
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });

// Today: 1 -> 2 -> 4 costs 2000; the alternative 1 -> 3 -> 4 costs `alt`.
function setup({ alt = 3000, expectedFn = (o) => o.filter((x) => !(x.from === 1 && x.to === 2)), shipMap = ships } = {}) {
  const offers = [std(1, 2, 1000), std(2, 4, 1000), std(1, 3, alt - 1000), std(3, 4, 1000)];
  const expected = expectedFn(offers);
  const plans = newState();
  addChain(plans, { base: 1, target: 4, name: 'Goal' });
  const graph = buildGraph({ offers, owned: [], ships: shipMap });
  const route = proposeChain(plans, 'c1', graph, { k: 1 }).routes[0];
  return { offers, expected, plans, graph, route, ctx: { session: createSession({ plans, graph }), chainId: 'c1' }, shipMap };
}
// The alert texts a page shows: routeAdvice for the goal as a finish goal (no step is skipped for a lock).
const adviceTexts = (route, expected, ships, avail, ctx) => routeAdvice(ctx?.session ?? null, ctx ? { id: ctx.chainId, mode: 'finish' } : null, route, { ships, expected, avail }).alerts.map((a) => a.text);
const texts = (x, avail = null) => adviceTexts(x.route, x.expected, x.shipMap, avail, x.ctx);

test('gone, waiting costs money: the alert stays with the extra cost', () => {
  const x = setup({ alt: 4000 }); // after the change the best plan is 4000 against 2000 now
  assert.deepEqual(x.route.steps.map((s) => `${s.from}-${s.to}`), ['1-2', '2-4']);
  const ch = expectedChanges(x.route, x.expected, x.shipMap, null, x.ctx);
  assert.equal(ch.buyBefore.length, 1);
  assert.equal(ch.buyBefore[0].reason, 'gone');
  assert.equal(ch.buyBefore[0].saves, 2000);
  assert.deepEqual(texts(x), ['Buy before the price changes: Start → Bridge $10 now, no Standard upgrade after (waiting costs $20 more)']);
});

test('gone, an alternative costs the same: the alert is dropped (the real case)', () => {
  const x = setup({ alt: 2000 });
  const ch = expectedChanges(x.route, x.expected, x.shipMap, null, x.ctx);
  assert.deepEqual(ch.alerts, []);
  assert.deepEqual(ch.buyBefore, []);
  assert.equal(ch.dropped.length, 1);
  assert.deepEqual(texts(x), []);
  // Without a context the alert stays as before.
  assert.equal(expectedChanges(x.route, x.expected, x.shipMap).buyBefore.length, 1);
});

test('pricier: the step rises from 1000 to 3000, the alternative costs 1500 more, so waiting costs 1500', () => {
  const x = setup({ alt: 3500, expectedFn: (o) => o.map((e) => (e.from === 1 && e.to === 2 ? { ...e, cash: 3000, assumed: true } : e)) });
  const ch = expectedChanges(x.route, x.expected, x.shipMap, null, x.ctx);
  assert.equal(ch.buyBefore.length, 1);
  assert.equal(ch.buyBefore[0].reason, 'pricier');
  assert.equal(ch.buyBefore[0].saves, 1500);
  assert.match(texts(x)[0], /\$30 after \(waiting costs \$15 more\)$/);
});

test('pricier but the alternative is not dearer than the new price: dropped', () => {
  const x = setup({ alt: 2500, expectedFn: (o) => o.map((e) => (e.from === 1 && e.to === 2 ? { ...e, cash: 3000, assumed: true } : e)) });
  // after = 2500 (alternative), bought now = 2000: waiting still costs 500
  assert.equal(expectedChanges(x.route, x.expected, x.shipMap, null, x.ctx).buyBefore[0].saves, 500);
  const y = setup({ alt: 2000, expectedFn: (o) => o.map((e) => (e.from === 1 && e.to === 2 ? { ...e, cash: 3000, assumed: true } : e)) });
  assert.deepEqual(expectedChanges(y.route, y.expected, y.shipMap, null, y.ctx).buyBefore, []);
});

test('no route after the change: the alert stays and says waiting leaves no route', () => {
  const offers = [std(1, 2, 1000), std(2, 4, 1000)];
  const expected = offers.filter((o) => !(o.from === 1 && o.to === 2));
  const plans = newState();
  addChain(plans, { base: 1, target: 4 });
  const graph = buildGraph({ offers, owned: [], ships });
  const route = proposeChain(plans, 'c1', graph, { k: 1 }).routes[0];
  const ctx = { session: createSession({ plans, graph }), chainId: 'c1' };
  const ch = expectedChanges(route, expected, ships, null, ctx);
  assert.equal(ch.buyBefore[0].saves, Infinity);
  assert.deepEqual(adviceTexts(route, expected, ships, null, ctx), ['Buy before the price changes: Start → Bridge $10 now, no Standard upgrade after (waiting leaves no route)']);
});

test('concept and event alerts are not checked', () => {
  // The event alert needs a filler into a ship sold only during events: ships $5 apart, ship 2 marked event-only.
  const concept = new Map([...ships].map(([id, s]) => [id, { ...s, concept: id === 2 }]));
  const x = setup({ alt: 2000, expectedFn: (o) => o, shipMap: concept }); // same-cost alternative, nothing expected to change
  const ch = expectedChanges(x.route, x.expected, concept, null, x.ctx);
  assert.deepEqual(ch.buyBefore.map((a) => [a.step.to, a.reason, a.saves]), [[2, 'concept', undefined]]);
  assert.deepEqual(texts(x).length, 1);

  const fillers = new Map([...ships].map(([id, s]) => [id, { ...s, msrp: 9000 + id * 500 }]));
  const eventData = { ships: fillers, saleHistory: { ships: { 2: { onSaleDays: ['2026-11-18'] } } }, saleEvents: { rev: 1, events: [{ id: 'e', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }] } };
  const avail = availCtx({ data: eventData, overrides: { ships: { 2: { availability: 'event-only' } } } }, '2026-11-18');
  const e = setup({ alt: 2000, expectedFn: (o) => o });
  const ev = expectedChanges(e.route, e.expected, fillers, avail, e.ctx);
  assert.ok(ev.buyBefore.some((a) => a.reason === 'event' && a.saves === undefined));
  assert.ok(ev.buyBefore.every((a) => a.reason === 'event' && a.saves === undefined));
});

test('no gone or pricier alert: no extra search runs', () => {
  const x = setup({ expectedFn: (o) => o });
  const before = planGoals(x.plans, x.graph);
  let touched = false;
  const spy = { get session() { touched = true; return createSession({ plans: x.plans, graph: x.graph }); }, chainId: 'c1' };
  assert.deepEqual(expectedChanges(x.route, x.expected, x.shipMap, null, spy).alerts, []);
  assert.equal(touched, false);
  assert.equal(planGoals(x.plans, x.graph), before);
});

test('journey: the dropped alert is gone from the step, a kept one carries the cost', () => {
  const same = setup({ alt: 2000 });
  const j1 = journey(same.route, same.plans.chains.c1, { session: createSession({ plans: same.plans, graph: same.graph }), ships: same.shipMap, expected: same.expected });
  assert.equal(j1.steps.filter((s) => s.alert).length, 0);
  const dear = setup({ alt: 4000 });
  const j2 = journey(dear.route, dear.plans.chains.c1, { session: createSession({ plans: dear.plans, graph: dear.graph }), ships: dear.shipMap, expected: dear.expected });
  assert.match(j2.steps.find((s) => s.alert).alert, /waiting costs \$20 more/);
});

function world({ alt, goals = 1 }) {
  const x = setup({ alt });
  const plans = newState();
  for (let i = 0; i < goals; i++) addChain(plans, { base: 1, target: 4, name: `G${i}` });
  return { data: { ships, offers: x.offers, owned: [], meta: { catalogAt: 'C', hangarAt: 'H' }, warbondPrices: null, saleHistory: null }, graph: x.graph, plans, overrides: emptyOverrides(), saleEvents: emptySaleEvents(), expected: x.expected };
}

test('today: a dropped alert gives no buy-before notice, a kept one does', () => {
  const dropped = todayView(world({ alt: 2000 }));
  assert.equal(dropped.waiting.alerts.length, 0);
  assert.equal(dropped.waiting.notices.length, 0);
  const kept = todayView(world({ alt: 4000 }));
  assert.equal(kept.waiting.alerts.length, 1);
  assert.match(kept.waiting.alerts[0].text, /waiting costs \$20 more/);
});

// ----- several affected steps on one route; objective, credit and claimed copies -----

// 1 -> 2 -> 3 -> 4 at 1000 each (3000), plus `extra` offers. After the change the 1 -> 2 and 2 -> 3 upgrades are gone.
function chainWorld({ extra = [], owned = [], credit = 0, objective = null, goals = null } = {}) {
  const offers = [std(1, 2, 1000), std(2, 3, 1000), std(3, 4, 1000), ...extra];
  const expected = offers.filter((o) => !(o.to === 2 || o.to === 3));
  const plans = newState();
  plans.profile.credit = credit;
  for (const g of goals ?? [{}]) addChain(plans, { base: 1, target: 4, ...g });
  if (objective) setObjective(plans, 'c1', objective);
  const graph = buildGraph({ offers, owned, ships });
  const route = proposeChain(plans, 'c1', graph, { k: 1 }).routes[0];
  const ctx = { session: createSession({ plans, graph }), chainId: 'c1' };
  return { offers, expected, plans, graph, route, ctx, changes: () => expectedChanges(route, expected, ships, null, ctx) };
}
const gone = (ch) => ch.buyBefore.map((a) => [`${a.step.from}-${a.step.to}`, a.saves]);

test('two affected steps and no route after the change: both alerts stay, waiting leaves no route', () => {
  const w = chainWorld();
  assert.deepEqual(gone(w.changes()), [['1-2', Infinity], ['2-3', Infinity]]);
  assert.equal(adviceTexts(w.route, w.expected, ships, null, w.ctx).filter((t) => t.endsWith('(waiting leaves no route)')).length, 2);
});

test('two affected steps, a dearer alternative: both alerts share the penalty', () => {
  const w = chainWorld({ extra: [std(1, 4, 4000)] });
  assert.deepEqual(gone(w.changes()), [['1-2', 1000], ['2-3', 1000]]);
});

test('no route even when everything is bought now: the alert stays without a penalty and with the plain text', () => {
  const w = chainWorld();
  const tight = { session: createSession({ plans: w.plans, graph: w.graph, maxSteps: 1 }), chainId: 'c1' }; // three steps do not fit
  const ch = expectedChanges(w.route, w.expected, ships, null, tight);
  assert.equal(ch.buyBefore.length, 2);
  assert.ok(ch.buyBefore.every((a) => a.saves === undefined));
  assert.deepEqual(adviceTexts(w.route, w.expected, ships, null, tight)[0], 'Buy before the price changes: Start → Bridge $10 now, no Standard upgrade after');
});

test('allin goal: the penalty is in all-in cost, so a consumed owned copy counts', () => {
  const owned = [{ copyId: 'x', from: 1, to: 4, paid: { cents: 3500 } }];
  const extra = [std(1, 4, 4000)];
  // Cash objective: the owned copy is free after the change, so waiting costs nothing.
  assert.deepEqual(chainWorld({ extra, owned }).route.steps.map((s) => s.kind), ['owned']);
  // The route is the owned copy: nothing to warn about. Judge the Standard route directly instead.
  const w = chainWorld({ extra, owned, objective: 'allin' });
  const std3 = { steps: [std(1, 2, 1000), std(2, 3, 1000), std(3, 4, 1000)].map((o) => ({ ...o })) };
  const allin = expectedChanges(std3, w.expected, ships, null, w.ctx);
  assert.deepEqual(gone(allin), [['1-2', 500], ['2-3', 500]]); // after 3500 (copy), bought now 3000
  const cash = chainWorld({ extra, owned });
  assert.deepEqual(expectedChanges(std3, cash.expected, ships, null, cash.ctx).buyBefore, []); // copy is free in cash terms
});

test('credit pays Standard steps: with enough credit waiting costs nothing', () => {
  const extra = [std(1, 4, 4000)];
  assert.deepEqual(gone(chainWorld({ extra, credit: 2000 }).changes()), [['1-2', 1000], ['2-3', 1000]]); // 1000 cash against 2000 cash
  assert.deepEqual(chainWorld({ extra, credit: 5000 }).changes().buyBefore, []); // both routes are free
});

test('a copy claimed by another goal is not used by the after-change route', () => {
  const owned = [{ copyId: 'x', from: 1, to: 4, paid: { cents: 100 } }];
  const extra = [std(1, 4, 4000)];
  const plans = newState();
  addChain(plans, { base: 1, target: 4, name: 'Mine' });
  addChain(plans, { base: 1, target: 4, name: 'Other', priority: 'high' });
  const offers = [std(1, 2, 1000), std(2, 3, 1000), std(3, 4, 1000), ...extra];
  const graph = buildGraph({ offers, owned, ships });
  const other = proposeChain(plans, 'c2', graph, { k: 1 }).routes[0];
  assert.equal(other.steps[0].copyId, 'x');
  acceptRoute(plans, 'c2', other);
  const route = proposeChain(plans, 'c1', graph, { k: 1 }).routes[0];
  assert.deepEqual(route.steps.map((s) => s.kind), ['standard', 'standard', 'standard']);
  const expected = offers.filter((o) => !(o.to === 2 || o.to === 3));
  const ch = expectedChanges(route, expected, ships, null, { session: createSession({ plans, graph }), chainId: 'c1' });
  assert.deepEqual(gone(ch), [['1-2', 1000], ['2-3', 1000]], 'the claimed copy would have made it free');
});

test('decision and journey agree when a covered or locked step is left out of the alert route', () => {
  // 1 -> 2 -> 3. After the change 1 -> 2 is gone and 2 -> 3 costs 3000; the alternative 1 -> 3 costs 3000.
  const offers = [std(1, 2, 1000), std(2, 3, 1000), std(1, 3, 3000)];
  const expected = [{ ...std(2, 3, 3000), assumed: true, nowCash: 1000 }, std(1, 3, 3000)];
  const plans = newState();
  addChain(plans, { base: 1, target: 3 });
  const graph = buildGraph({ offers, owned: [], ships });
  const route = proposeChain(plans, 'c1', graph, { k: 1 }).routes[0];
  const ctx = { session: createSession({ plans, graph }), chainId: 'c1' };
  const keys = (r, c) => expectedChanges(r, expected, ships, null, c).buyBefore.map((a) => [`${a.step.from}-${a.step.to}`, a.saves, a.together]);
  const full = keys(route, ctx);
  assert.deepEqual(full, [['1-2', 1000, true], ['2-3', 1000, true]]);
  assert.match(adviceTexts(route, expected, ships, null, ctx)[0], /\(waiting costs \$10 more for these steps together\)$/);
  // The journey (whole route, locked step skipped) keeps the same alert.
  const j = journey(route, plans.chains.c1, { session: ctx.session, ships, expected });
  assert.match(j.steps[0].alert, /waiting costs \$10 more for these steps together/);
});
