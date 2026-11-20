// The pages must never disagree about one goal: Today, the goal journey, the decision graph and the CLI
// wording all come from the same routeAdvice, so for every goal they show the same buy-now steps and alerts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { emptyOverrides } from '../src/logic/prices.mjs';
import { emptySaleEvents } from '../src/logic/availability.mjs';
import { sessionOf } from '../src/logic/session.mjs';
import { journey } from '../src/logic/journey.mjs';
import { decisionGraph } from '../src/logic/decision.mjs';
import { buyBeforeText, eventAlertText, eventLockDecision, standardLaterText, buyGroupLines, goalStatusText, heroBuyTitle } from '../src/logic/describe.mjs';
import { shipAvailability } from '../src/logic/availability.mjs';
import { usd } from '../src/logic/format.mjs';
import { todayView } from '../app/src/lib/view/today.mjs';

const DAY = '2026-11-18';
const NAMES = { 1: 'Start', 2: 'Bridge', 3: 'Other', 4: 'Target' };
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });
const wb = (from, to, cash) => ({ from, to, kind: 'warbond', cash, skuId: 7 });
const shipsOf = (concept = []) => new Map([1, 2, 3, 4].map((id) => [id, { id, name: NAMES[id], msrp: id * 5000, concept: concept.includes(id), onSale: true, standard: true }]));
const key = (s) => `${s.kind}:${s.from}-${s.to}`;

// Each fixture: offers today, expected offers after your price changes, goal settings, concept ships.
const FIXTURES = {
  'warbond now, standard later': { offers: [wb(1, 2, 1000), std(2, 4, 10000)], goal: {} },
  'a rising price on a later step': { offers: [std(1, 2, 5000), std(2, 4, 10000)], expected: [std(1, 2, 5000), std(2, 4, 12000)], goal: { lock: 'off' } },
  'the last step locks (lock on) and an earlier one rises': { offers: [std(1, 2, 5000), std(2, 4, 10000)], expected: [std(1, 2, 7000), std(2, 4, 10000)], goal: { lock: 'on' } },
  'concept target locks by itself': { offers: [std(1, 2, 5000), std(2, 4, 10000)], concept: [4], goal: {} },
  'finish mode buys everything now': { offers: [wb(1, 2, 1000), std(2, 4, 10000)], expected: [std(2, 4, 12000)], goal: { mode: 'finish' } },
  'a step that goes away': { offers: [std(1, 2, 1000), std(2, 4, 1000), std(1, 3, 4000), std(3, 4, 1000)], expected: [std(2, 4, 1000), std(1, 3, 4000), std(3, 4, 1000)], goal: { lock: 'off' } },
  'an ongoing sale event makes an event-only target lock now': { offers: [std(1, 2, 5000), std(2, 4, 10000)], event: true, goal: {} },
  'a saturated limited flag is ignored': { offers: [{ ...wb(1, 2, 1000), limited: true }, std(2, 4, 10000)], meta: { limitedShare: { warbond: 1, standard: 0 } }, goal: {} },
  'a buy-before alert that saves money is promoted to buy today': { offers: [std(1, 2, 5000), std(2, 4, 10000)], expected: [std(1, 2, 5000), std(2, 4, 12000)], promoted: true, goal: { lock: 'off' } },
  'a limited-time Warbond is bought today': { offers: [{ ...wb(1, 2, 1000), limited: true }, std(2, 4, 10000)], goal: {} },
  'an old Warbond is no rush': { offers: [{ ...wb(1, 2, 1000), firstSeen: '2026-11-10T12:00:00.000Z' }, std(2, 4, 10000)], goal: {} },
  'a sale event that ends tomorrow makes the Warbond urgent': { offers: [wb(1, 2, 1000), std(2, 4, 10000)], event: true, eventTo: '2026-11-19', goal: { lock: 'off' } },
  'an owned CCU covers the lock': { offers: [std(1, 2, 5000), std(2, 4, 10000), std(1, 3, 5000)], owned: [{ from: 3, to: 4, copyId: 'k', paid: { cents: 100 } }], goal: { lock: 'on' } },
};

function appFor(f) {
  const ships = shipsOf(f.concept);
  const owned = f.owned ?? [];
  const plans = newState();
  addChain(plans, { base: 1, target: 4, name: 'Goal', ...f.goal });
  if (f.goal.lock) plans.chains.c1.lock = f.goal.lock;
  return {
    data: { ships, offers: f.offers, owned, meta: { catalogAt: 'C', hangarAt: 'H', ...f.meta }, warbondPrices: null, saleHistory: f.event ? { ships: { 4: { onSaleDays: [DAY] } } } : null },
    // During the event fixtures the target has only ever been sold during events (the lock and alerts need that proof).
    graph: buildGraph({ offers: f.offers, owned, ships }), plans, overrides: f.event ? { ...emptyOverrides(), ships: { 4: { availability: 'event-only' } } } : emptyOverrides(),
    saleEvents: f.event ? { rev: 1, events: [{ id: 'e', name: 'IAE 2956', from: '2026-11-14', to: f.eventTo ?? '2026-11-27' }] } : emptySaleEvents(), expected: f.expected ?? f.offers,
  };
}

for (const [title, fixture] of Object.entries(FIXTURES)) {
  test(`Today, journey, decision graph and CLI wording agree: ${title}`, () => {
    const app = appFor(fixture);
    const session = sessionOf(app);
    const route = session.route('c1');
    assert.ok(route, 'the fixture has a route');
    const adv = session.advice('c1', { route, day: DAY });
    const ships = app.data.ships;
    const name = (id) => NAMES[id];

    // Today
    const today = todayView(app, DAY);
    const goal = today.goals[0];
    const todayBuys = today.buys.filter((b) => b.goalId === 'c1').map((b) => key(b.step));
    const todayAlerts = today.waiting.alerts.filter((a) => a.goalId === 'c1').map((a) => [key(a.step), a.text]);

    // The goal journey as a page builds it, from the same session
    const j = journey(route, app.plans.chains.c1, { session, ships, overrides: app.overrides, expected: app.expected, avail: session.avail(DAY), warbondPrices: null, saleEvents: null });
    const journeyBuys = j.steps.filter((x) => x.state === 'now').map((x) => key(x.step));
    const journeyAlerts = j.steps.filter((x) => x.alert).map((x) => [key(x.step), x.alert]);

    // The advice itself
    // Every purchase to make now, whatever its urgency (a later step waiting would make dearer counts too).
    const adviceBuys = adv.buys.map((b) => key(b.step));
    const adviceAlerts = adv.alerts.map((a) => [key(a.step), a.text]);

    // CLI wording: the same alerts, the CLI arrow
    const cliAlerts = adv.alerts.map((a) => [key(a.step), buyBeforeText(a, { name, arrow: '->' })]);

    if (fixture.promoted) assert.ok(adv.buys.some((b) => b.promoted && b.bucket === 'today'), 'a promoted step is in the buy-today group');
    if (fixture.meta) assert.deepEqual(adv.buys.map((b) => b.bucket), ['norush', ...adv.buys.slice(1).map((b) => b.bucket)], 'the ignored flag leaves the Warbond at no rush');
    // "Buy now" is one number everywhere: the headline, the goal card, the goal journey and the CLI's group lines.
    const advToday = adv.buys.filter((b) => b.bucket === 'today');
    assert.equal(today.hero.buyCount, advToday.length, 'the Today headline counts the advice\'s buy-today steps');
    assert.equal(goal.buyCount, advToday.length, 'the goal card counts them too');
    assert.equal(j.steps.filter((x) => x.urgency === 'today').length, advToday.length, 'the goal journey too');
    assert.equal(today.hero.buyCash, advToday.reduce((n, b) => n + b.step.cash, 0));
    if (advToday.length) {
      assert.equal(heroBuyTitle(today.hero.buyCount, usd(today.hero.buyCash)), `Today: buy ${advToday.length} upgrade${advToday.length === 1 ? '' : 's'} · ${usd(today.hero.buyCash)}`);
      assert.match(goalStatusText(goal), new RegExp(`^Buy ${advToday.length} today`));
    } else assert.doesNotMatch(goalStatusText(goal), /today/);
    const cli = buyGroupLines(adv.buys, { name, arrow: '->' });
    for (const [bucket, rows] of Object.entries({ today: today.buyList.today, norush: today.buyList.norush, optional: today.buyList.optional })) {
      const line = cli.find((l) => l.startsWith({ today: 'buy now', norush: 'on sale', optional: 'optional' }[bucket]));
      assert.equal(!!line, rows.length > 0, `the CLI has a ${bucket} line exactly when Today has ${bucket} rows`);
      for (const r of rows) assert.ok(line.includes(`${name(r.from)} -> ${name(r.to)}`), `the CLI line names ${name(r.from)} -> ${name(r.to)}`);
    }
    assert.equal(cli.length, ['today', 'norush', 'optional'].filter((b) => today.buyList[b].length).length);

    const sorted = (x) => [...x].sort();
    assert.deepEqual(sorted(todayBuys), sorted(adviceBuys), 'Today buys what the advice says');
    assert.deepEqual(sorted(journeyBuys), sorted(adviceBuys), 'the journey buys what the advice says');
    assert.deepEqual(journeyAlerts, adviceAlerts, 'journey alerts are the advice alerts');
    assert.deepEqual(goal.journey.steps.map((x) => [key(x.step), x.state, x.alert]), j.steps.map((x) => [key(x.step), x.state, x.alert]), 'Today shows the same journey');
    assert.deepEqual(todayAlerts, adviceAlerts, 'Today lists the same alerts');
    assert.deepEqual(cliAlerts.map(([k, t]) => [k, t.replaceAll(' -> ', ' → ')]), adviceAlerts, 'the CLI words the same alerts');

    // The decision graph words each step from the same advice: the expected sentence is built from the advice's alerts, lock and cover.
    if (fixture.event && fixture.goal.lock !== 'off') assert.equal(adv.lockCode, 'event', 'the event fixture locks through the event reason');
    const g = decisionGraph(app, 'c1', { wanted: null, today: DAY, avail: session.avail(DAY) });
    assert.equal(g.steps.length, route.steps.length, 'the decision graph shows the best route');
    const WHY = { concept: 'target is a concept ship', expected: 'you expect its price to rise', on: 'lock is set to on' };
    g.steps.forEach((s, i) => {
      const step = route.steps[i];
      const k = key(step);
      const alert = adv.alerts.find((a) => key(a.step) === k);
      const locked = adv.groups.lockNow.some((x) => key(x) === k);
      const last = i === route.steps.length - 1;
      if (step.kind !== 'standard') return assert.match(s.decision, step.kind === 'owned' ? /^Use your owned CCU/ : /^Buy Warbond /);
      let want;
      if (locked) want = adv.lockCode === 'event' ? eventLockDecision(step.cash, adv.lockEvent) : `Buy Standard ${usd(step.cash)} later, or lock now: ${WHY[adv.lockCode]}.`;
      else if (alert?.reason === 'event') want = `Buy Standard ${usd(step.cash)} before the sale ends: ${eventAlertText(alert)}.`;
      else if (alert?.reason === 'pricier') want = `Buy Standard ${usd(step.cash)} before the price rises to ${usd(alert.expected)}.`;
      else if (adv.finish) want = `Buy Standard ${usd(step.cash)}: the chain is in finish mode.`;
      else want = standardLaterText(step.cash, shipAvailability(session.avail(DAY), step.to).status);
      if (adv.dec.covered && last) want += ` ${adv.coverText}`;
      assert.equal(s.decision, want, `${k}`);
    });
  });
}

test('two goals sharing a Warbond pair, one with a covered lock: Today, the advice and the CLI agree', () => {
  // 1 Start, 2 Bridge, 3 Orion (concept), 4 Ironclad. Goal A: Start -> Orion (Warbond 1-2, then the Standard lock 2-3, covered by your owned Ironclad -> Orion).
  // Goal B: Start -> Bridge, which needs the same Warbond.
  const names = { 1: 'Start', 2: 'Bridge', 3: 'Orion', 4: 'Ironclad' };
  const ships = new Map([1, 2, 3, 4].map((id) => [id, { id, name: names[id], msrp: id * 5000, concept: id === 3, onSale: true, standard: true }]));
  const offers = [{ ...wb(1, 2, 1000), limited: true }, std(2, 3, 5000), std(1, 4, 8000)];
  const owned = [{ from: 4, to: 3, copyId: 'k', paid: { cents: 100 } }];
  const plans = newState();
  addChain(plans, { base: 1, target: 3, name: 'A' });
  addChain(plans, { base: 1, target: 2, name: 'B' });
  const app = { data: { ships, offers, owned, meta: { catalogAt: 'C', hangarAt: 'H' }, warbondPrices: null, saleHistory: null }, graph: buildGraph({ offers, owned, ships }), plans, overrides: emptyOverrides(), saleEvents: emptySaleEvents(), expected: offers };
  const session = sessionOf(app);
  const today = todayView(app, DAY);
  const advA = session.advice('c1', { day: DAY });
  assert.equal(advA.dec.covered, true, 'the lock of goal A is covered by your owned CCU');
  assert.equal(advA.buys.some((b) => b.lock), false, 'so it is not a lock row');
  const rows = [...today.buyList.today, ...today.buyList.norush, ...today.buyList.optional];
  assert.deepEqual(rows.map((r) => [r.key, r.bucket, r.count]), [['warbond|1-2|1000', 'today', 2]], 'one row for the shared pair, bought twice');
  assert.equal(today.hero.buyCount, 2);
  const perGoal = ['c1', 'c2'].map((id) => session.advice(id, { day: DAY }).buys.filter((b) => b.bucket === 'today').length);
  assert.deepEqual(today.goals.map((g) => g.buyCount).sort(), [...perGoal].sort());
  assert.equal(today.hero.buyCount, perGoal[0] + perGoal[1]);
  const name = (id) => names[id];
  for (const id of ['c1', 'c2']) {
    const lines = buyGroupLines(session.advice(id, { day: DAY }).buys, { name });
    assert.ok(lines.some((l) => l.startsWith('buy now') && l.includes('Start -> Bridge')), `the CLI lists the shared Warbond for ${id}`);
  }
});
