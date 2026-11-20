import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../src/logic/planner.mjs';
import { newState, addChain } from '../../src/logic/chains.mjs';
import { emptyOverrides } from '../../src/logic/prices.mjs';
import { deriveAppState } from '../../app/src/lib/view/derive.mjs';
import { todayView } from '../../app/src/lib/view/today.mjs';
import { lockReasonText } from '../../src/logic/describe.mjs';
import { emptySaleEvents } from '../../src/logic/availability.mjs';
import { usd } from '../../src/logic/format.mjs';

const IAE_EVENT = { name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }; // the sale these fixtures run in

const ship = (id, name, msrp, concept = false) => [id, { id, name, msrp, concept, owned: false, onSale: true }];
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });
const wb = (from, to, cash, skuId = 1) => ({ from, to, kind: 'warbond', cash, skuId });
/** A Warbond that is a limited-time offer: it goes in "Buy today". */
const wbL = (from, to, cash, skuId = 1) => ({ ...wb(from, to, cash, skuId), limited: true });

test('deriveAppState(null) is null and usd formats cents', () => {
  assert.equal(deriveAppState(null, {}), null);
  assert.equal(usd(4250), '$42.50');
  assert.equal(usd(4000), '$40');
  assert.equal(usd(null), '?');
});

// ----- todayView: goals, journeys, hero, buys, waiting, melt -----

/** A whole app for todayView: goals are addChain options, in creation order (c1, c2, ...). */
function world({ ships, offers = [], owned = [], goals = [], expected = offers, saleEvents = null, overrides = null, warbondPrices = null, saleHistory = null, lti = [] }) {
  const plans = newState();
  for (const g of goals) {
    addChain(plans, { name: g.name, ...(g.start ? { start: g.start } : { base: g.base }), target: g.target, priority: g.priority ?? 'normal', mode: g.mode ?? 'watch' });
    if (g.lock) plans.chains[`c${plans.nextId - 1}`].lock = g.lock;
  }
  return {
    data: { ships: new Map(ships), offers, owned, meta: { catalogAt: 'C', hangarAt: 'H' }, warbondPrices, saleHistory },
    graph: buildGraph({ offers, owned, lti }),
    plans, overrides: overrides ?? emptyOverrides(), saleEvents: saleEvents ?? emptySaleEvents(), expected,
  };
}
const owned = (copyId, from, to) => ({ copyId, from, to, paid: null });
const SHIPS = [ship(1, 'A', 5000), ship(2, 'B', 7500), ship(3, 'C', 10000), ship(4, 'D', 12500), ship(5, 'E', 15000), ship(9, 'Z', 20000)];

test('todayView: zero goals -> empty, hero nothing, no goal, no melt, catalog and hangar dates', () => {
  const v = todayView(world({ ships: SHIPS }));
  assert.equal(v.empty, true);
  assert.equal(v.hero.nothing, true);
  assert.equal(v.hero.goalId, null);
  assert.equal(v.hero.shipId, null);
  assert.equal(v.hero.nothingWhy, null);
  assert.deepEqual(v.buys, []);
  assert.deepEqual(v.goals, []);
  assert.equal(v.melt, null);
  assert.equal(v.catalogAt, 'C');
  assert.equal(v.hangarAt, 'H');
});

test('todayView: a finish goal purchases are buys and count in the hero', () => {
  const v = todayView(world({
    ships: SHIPS, offers: [wbL(1, 2, 2000)], goals: [{ name: 'Fin', base: 1, target: 2, mode: 'finish' }],
  }));
  assert.equal(v.empty, false);
  assert.equal(v.buys.length, 1);
  assert.equal(v.buys[0].goalId, 'c1');
  assert.equal(v.buys[0].step.kind, 'warbond');
  assert.equal(v.buys[0].lock, false);
  assert.equal(v.buys[0].differs, false);
  assert.equal(v.hero.buyCount, 1);
  assert.equal(v.hero.buyCash, 2000);
  assert.deepEqual(v.hero.goalsTouched, ['c1']);
  assert.equal(v.hero.nothing, false);
  assert.equal(v.hero.nothingWhy, null);
  assert.equal(v.goals[0].buyCount, 1);
  assert.equal(v.goals[0].waitCount, 0);
  assert.equal(v.goals[0].status, 'buy');
});

test('todayView: the hero is the high-priority goal with a buy now, over a high-priority goal that only waits', () => {
  const v = todayView(world({
    ships: SHIPS,
    offers: [std(1, 2, 2500), wbL(1, 3, 4000)],
    goals: [
      { name: 'Waits', base: 1, target: 2, priority: 'high' },
      { name: 'Buys', base: 1, target: 3, priority: 'normal' },
    ],
  }));
  assert.equal(v.hero.goalId, 'c2');
  assert.equal(v.hero.shipId, 3);
  assert.equal(v.hero.buyCount, 1);
  assert.deepEqual(v.hero.goalsTouched, ['c2']);
});

test('todayView: with no buy now anywhere, the hero is the highest-priority goal (priority, then name)', () => {
  const v = todayView(world({
    ships: SHIPS,
    offers: [std(1, 2, 2500), std(1, 3, 9000)],
    goals: [
      { name: 'Zulu', base: 1, target: 3, priority: 'normal' },
      { name: 'Alpha', base: 1, target: 2, priority: 'normal' },
      { name: 'Low', base: 1, target: 2, priority: 'low' },
    ],
  }));
  assert.equal(v.hero.goalId, 'c2', 'normal priority, earlier name first');
  assert.equal(v.hero.nothing, true);
  assert.equal(v.hero.nothingWhy, 'waiting');
});

test('todayView: goal statuses done, buy, wait and no-route each appear', () => {
  const v = todayView(world({
    ships: SHIPS,
    owned: [owned('k12', 1, 2)],
    offers: [std(1, 2, 2500), wbL(1, 3, 4000), std(4, 5, 2500)],
    goals: [
      { name: 'Done', base: 1, target: 2 },
      { name: 'Buy', base: 1, target: 3 },
      { name: 'Wait', base: 4, target: 5 },
      { name: 'Lost', base: 5, target: 1 },
    ],
  }));
  const status = Object.fromEntries(v.goals.map((g) => [g.name, g.status]));
  assert.deepEqual(status, { Done: 'done', Buy: 'buy', Wait: 'wait', Lost: 'no-route' });
  const lost = v.goals.find((g) => g.name === 'Lost');
  assert.equal(lost.targetId, 1);
  assert.equal(lost.journey.steps.length, 0);
});

test('todayView: nothingWhy is all-owned when every goal is done', () => {
  const v = todayView(world({ ships: SHIPS, owned: [owned('k12', 1, 2)], goals: [{ name: 'Done', base: 1, target: 2 }] }));
  assert.equal(v.goals[0].status, 'done');
  assert.equal(v.hero.nothing, true);
  assert.equal(v.hero.nothingWhy, 'all-owned');
});

test('todayView: nothingWhy is no-route when no goal has a route', () => {
  const v = todayView(world({ ships: SHIPS, goals: [{ name: 'Lost', base: 5, target: 1 }] }));
  assert.equal(v.hero.nothing, true);
  assert.equal(v.hero.nothingWhy, 'no-route');
});

test('todayView: melt is null without melt candidates', () => {
  const v = todayView(world({ ships: SHIPS, offers: [std(1, 2, 2500)], goals: [{ name: 'Wait', base: 1, target: 2 }] }));
  assert.equal(v.melt, null);
});

test('todayView: a melt candidate is counted with its paid credit', () => {
  const copy = { copyId: 'k12', from: 1, to: 2, paid: { cents: 2500 }, meltable: true };
  // Ship 2 is on sale on two days 19 days apart outside any event: a regular Standard price, so the copy may be melted.
  const saleHistory = { ships: { 2: { onSaleDays: ['2026-10-01', '2026-10-20'] } } };
  const v = todayView(world({ ships: SHIPS, owned: [copy], offers: [std(1, 2, 2500)], saleHistory, goals: [{ name: 'Idle', base: 4, target: 5 }] }), '2026-11-18');
  assert.deepEqual(v.melt, { count: 1, credit: 2500 });
});

test('todayView: buys hold every now step in goal priority order, locks flagged with their reason', () => {
  const ships = [ship(1, 'A', 5000), ship(2, 'B', 7500, true), ship(3, 'C', 10000)];
  const v = todayView(world({
    ships,
    offers: [wbL(1, 3, 4000), std(1, 2, 2500)],
    goals: [
      { name: 'Low', base: 1, target: 3, priority: 'low' },
      { name: 'High', base: 1, target: 2, priority: 'high' },
    ],
  }));
  assert.deepEqual(v.buys.map((b) => b.goalId), ['c2', 'c1']);
  const lock = v.buys[0];
  assert.equal(lock.lock, true);
  assert.equal(lock.step.kind, 'standard');
  assert.equal(lock.reason, lockReasonText('concept'));
  assert.equal(v.buys[1].lock, false);
  // Only the Warbond is to be bought today; the lock is optional.
  assert.deepEqual(v.buys.map((b) => b.urgency), ['optional', 'today']);
  assert.equal(v.hero.buyCount, 1);
  assert.equal(v.hero.buyCash, 4000);
  assert.deepEqual(v.hero.goalsTouched, ['c1']);
  assert.equal(v.hero.goalId, 'c1');
});

test('todayView: waiting lists goals with wait steps, the wait count, and the expected-change alerts', () => {
  const v = todayView(world({
    ships: [ship(1, 'A', 5000), ship(2, 'B', 7500, true)],
    offers: [std(1, 2, 2500)],
    goals: [{ name: 'Wait', base: 1, target: 2, lock: 'off' }],
  }));
  assert.equal(v.waiting.count, 1);
  assert.deepEqual(v.waiting.goals, ['c1']);
  assert.equal(v.waiting.event, null);
  assert.deepEqual(v.waiting.eventOnly, []);
  assert.equal(v.waiting.alerts.length, 1);
  assert.equal(v.waiting.alerts[0].goalId, 'c1');
  assert.equal(v.waiting.alerts[0].step.kind, 'standard');
  assert.equal(typeof v.waiting.alerts[0].text, 'string');
  assert.ok(v.waiting.alerts[0].text.length > 0);
});

test('todayView: eventOnly lists a later Standard step into an event-only target while an event is ongoing', () => {
  const saleEvents = { rev: 1, events: [{ id: 'e1', ...IAE_EVENT }] };
  const app = world({
    ships: SHIPS,
    offers: [std(1, 2, 2500)],
    saleEvents,
    overrides: { rev: 1, ships: { 2: { availability: 'event-only' } } },
    goals: [{ name: 'Wait', base: 1, target: 2, lock: 'off' }],
  });
  const v = todayView(app, '2026-11-18');
  assert.deepEqual(v.waiting.event, { name: 'IAE 2956', to: '2026-11-27' });
  assert.equal(v.waiting.eventOnly.length, 1);
  assert.equal(v.waiting.eventOnly[0].goalId, 'c1');
  assert.equal(v.waiting.eventOnly[0].step.kind, 'standard');
  assert.deepEqual(v.waiting.eventOnly[0].event, { name: 'IAE 2956', to: '2026-11-27' });
  assert.equal(v.waiting.alerts.length, 1);
  assert.equal(v.goals[0].journey.steps[0].reason, 'Only known on sale during IAE 2956. Buy before Nov 27 or it may be gone.');

  const after = todayView(app, '2026-12-01');
  assert.equal(after.waiting.event, null);
  assert.deepEqual(after.waiting.eventOnly, []);
});

test('todayView: a watch goal whose accepted route differs from the best plan is flagged', () => {
  const app = world({
    ships: SHIPS,
    offers: [std(1, 2, 2500), wb(1, 2, 2000)],
    goals: [{ name: 'Watch', base: 1, target: 2 }],
  });
  assert.equal(todayView(app).buys[0].differs, false, 'no accepted route');
  app.plans.chains.c1.accepted = { rev: 1, cash: 2500, creditUsed: 0, steps: [std(1, 2, 2500)] };
  app.plans.rev = 1;
  assert.equal(todayView(app).buys[0].differs, true);
});

test('todayView: the same inputs give the memoised view; a new day or plans rev computes again', () => {
  const app = world({ ships: SHIPS, offers: [wb(1, 2, 2000)], goals: [{ name: 'Watch', base: 1, target: 2 }] });
  const a = todayView(app, '2026-11-18');
  assert.equal(todayView(app, '2026-11-18'), a);
  assert.notEqual(todayView(app, '2026-11-19'), a);
  app.plans.rev = 7;
  assert.notEqual(todayView(app, '2026-11-18'), a);
});

// ----- waiting notices (R8): one line per distinct from-to pair -----

const eventWorld = (goals) => world({
  ships: SHIPS,
  offers: [std(1, 2, 2500)],
  saleEvents: { rev: 1, events: [{ id: 'e1', ...IAE_EVENT }] },
  overrides: { rev: 1, ships: { 2: { availability: 'event-only' } } },
  goals,
});

test('todayView notices: two goals sharing a pair give one notice listing both goals', () => {
  const v = todayView(eventWorld([{ name: 'A', base: 1, target: 2, lock: 'off' }, { name: 'B', base: 1, target: 2, lock: 'off' }]), '2026-11-18');
  assert.equal(v.waiting.notices.length, 1);
  assert.deepEqual(v.waiting.notices[0].goals, ['c1', 'c2']);
  assert.equal(v.waiting.notices[0].from, 1);
  assert.equal(v.waiting.notices[0].to, 2);
});

test('todayView notices: event-only and alert for the same pair become one event-only sentence', () => {
  const v = todayView(eventWorld([{ name: 'A', base: 1, target: 2, lock: 'off' }]), '2026-11-18');
  assert.equal(v.waiting.alerts.length, 1);
  assert.equal(v.waiting.eventOnly.length, 1);
  assert.equal(v.waiting.notices.length, 1);
  assert.equal(v.waiting.notices[0].text, 'Only known on sale during IAE 2956. Buy before Nov 27 or it may be gone.');
  assert.equal(v.waiting.notices[0].eventOnly, true);
});

test('todayView notices: an alert-only pair is kept, without its own ship pair in the text', () => {
  const v = todayView(world({
    ships: [ship(1, 'A', 5000), ship(2, 'B', 7500, true)],
    offers: [std(1, 2, 2500)],
    goals: [{ name: 'Wait', base: 1, target: 2, lock: 'off' }],
  }));
  assert.equal(v.waiting.notices.length, 1);
  assert.equal(v.waiting.notices[0].eventOnly, false);
  assert.ok(v.waiting.notices[0].text.length > 0);
  assert.ok(!v.waiting.notices[0].text.includes('→'));
});

test('todayView: a token goal reports its planned start and token; without a free token the status is no-token', () => {
  const offers = [std(1, 2, 2500), std(2, 3, 2500)];
  const tok = { pledgeId: '7', ship: 1, name: 'A', paidCents: 3000, msrpCents: 5000 };
  const withTok = todayView(world({ ships: SHIPS, offers, lti: [tok], goals: [{ start: { kind: 'token' }, target: 3 }] }));
  const g = withTok.goals[0];
  assert.equal(g.startShip, 1);
  assert.equal(g.token.pledgeId, '7');
  assert.equal(g.token.ship, 1);
  assert.equal(g.noToken, false);
  assert.equal(g.journey.figures.fullPrice, 5000);
  const none = todayView(world({ ships: SHIPS, offers, goals: [{ start: { kind: 'token' }, target: 3 }] })).goals[0];
  assert.equal(none.status, 'no-token');
  assert.equal(none.noToken, true);
  assert.equal(none.startShip, null);
  assert.equal(none.token, null);
  const fixed = todayView(world({ ships: SHIPS, offers, goals: [{ base: 1, target: 3 }] })).goals[0];
  assert.equal(fixed.startShip, 1);
  assert.equal(fixed.token, null);
  assert.equal(fixed.noToken, false);
});

test('todayView: when every goal lacks a token nothing is to buy and nothingWhy is no-token', () => {
  const offers = [std(1, 2, 2500)];
  const v = todayView(world({ ships: SHIPS, offers, goals: [{ start: { kind: 'token' }, target: 2 }, { start: { kind: 'token' }, target: 3 }] }));
  assert.deepEqual(v.goals.map((g) => g.status), ['no-token', 'no-token']);
  assert.equal(v.hero.nothing, true);
  assert.equal(v.hero.nothingWhy, 'no-token');
  assert.equal(v.buys.length, 0);
});

test('todayView: goal entries carry the target name and the start line', () => {
  const offers = [std(1, 2, 2500), std(2, 3, 2500)];
  const tok = { pledgeId: '7', ship: 1, name: 'A', paidCents: 3000, msrpCents: 5000 };
  const gs = todayView(world({ ships: SHIPS, offers, lti: [tok], goals: [{ start: { kind: 'token' }, target: 3 }, { base: 2, target: 3 }, { start: { kind: 'token' }, target: 5 }] })).goals;
  assert.deepEqual(gs.map((g) => g.targetName), ['C', 'C', 'E']);
  assert.equal(gs[0].startLine, 'from your A \u00b7 LTI');
  assert.equal(gs[1].startLine, 'from B (fixed)');
  assert.equal(gs[2].startLine, 'needs a starting ship');
});

test('goal cards add up to the plan total: an accepted goal counts at its accepted price, and the card says so when today differs', async () => {
  const { acceptRoute } = await import('../../src/logic/chains.mjs');
  const { sessionOf } = await import('../../src/logic/session.mjs');
  const { acceptedDriftNote } = await import('../../src/logic/describe.mjs');
  const ships = [ship(1, 'Pulse', 5000), ship(2, 'Hercules', 7500), ship(3, 'Carrack', 10000)];
  const cheap = world({ ships, offers: [std(1, 2, 2500), std(1, 3, 5000)], goals: [{ name: 'Hercules', base: 1, target: 2 }, { name: 'Carrack', base: 1, target: 3 }] });
  const route = sessionOf(cheap).route('c1');
  acceptRoute(cheap.plans, 'c1', route);
  // The store reprices Pulse -> Hercules after the goal was accepted.
  const offers = [std(1, 2, 3100), std(1, 3, 5000)];
  const app = { ...cheap, data: { ...cheap.data, offers }, graph: buildGraph({ offers, owned: [] }), expected: offers };
  const v = todayView(app);
  const total = sessionOf(app).fleet().totalCash;
  assert.equal(v.goals.reduce((n, g) => n + (g.countedCash ?? 0), 0), total, 'the numbers the cards count add up to the total');
  const g1 = v.goals.find((g) => g.goalId === 'c1');
  assert.equal(g1.acceptedCash, 2500);
  assert.equal(g1.cash, 3100);
  const drift = v.goals.filter((g) => g.acceptedCash != null && g.cash != null && g.acceptedCash !== g.cash);
  assert.equal(v.goals.reduce((n, g) => n + (g.cash ?? 0), 0) - total, drift.reduce((n, g) => n + g.cash - g.acceptedCash, 0), 'the gap is exactly the accepted-price drift');
  assert.equal(acceptedDriftNote([{ name: 'Hercules', accepted: 2500, now: 3100 }]), 'Reserved chains count at the price you reserved them at: Hercules $25 reserved, $31 now.');
  assert.equal(acceptedDriftNote([]), null);
});
