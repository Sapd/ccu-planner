// Today's buy list: one row per pair across goals, in three urgency groups, with payment and price context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../src/logic/planner.mjs';
import { newState, addChain } from '../../src/logic/chains.mjs';
import { emptyOverrides } from '../../src/logic/prices.mjs';
import { applyAction } from '../../src/logic/state.mjs';
import { emptySaleEvents } from '../../src/logic/availability.mjs';
import { todayView, dontLockAction, offerNoteAction, clearOfferNoteAction } from '../../app/src/lib/view/today.mjs';

const DAY = '2026-11-19';
const iso = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
const ship = (id, name, msrp, concept = false) => [id, { id, name, msrp, concept, owned: false, onSale: true, standard: true }];
const SHIPS = [ship(1, 'Start', 5000), ship(2, 'Bridge', 7500), ship(3, 'Orion', 10000, true), ship(4, 'Liberator', 15000), ship(5, 'Galaxy', 20000)];
const std = (from, to, cash, extra = {}) => ({ from, to, kind: 'standard', cash, ...extra });
const wb = (from, to, cash, extra = {}) => ({ from, to, kind: 'warbond', cash, skuId: 1, ...extra });

function world({ offers, goals, credit = 0, overrides = null, saleEvents = null, owned = [], meta = {} }) {
  const plans = newState();
  for (const g of goals) {
    addChain(plans, { name: g.name, base: g.base, target: g.target, priority: g.priority ?? 'normal', mode: g.mode ?? 'watch' });
    if (g.lock) plans.chains[`c${plans.nextId - 1}`].lock = g.lock;
  }
  plans.profile.credit = credit;
  return {
    data: { ships: new Map(SHIPS), offers, owned, meta: { catalogAt: 'C', hangarAt: 'H', ...meta }, warbondPrices: null, saleHistory: null },
    graph: buildGraph({ offers, owned, ships: new Map(SHIPS) }), plans, overrides: overrides ?? emptyOverrides(), saleEvents: saleEvents ?? emptySaleEvents(), expected: offers,
  };
}
const rowsOf = (v) => Object.fromEntries(['today', 'norush', 'optional'].map((b) => [b, v.buyList[b].map((r) => `${r.kind}:${r.from}-${r.to}`)]));

test('the same pair in two goals is one row: buy 2, naming both goals', () => {
  // Both goals buy Start -> Bridge ($15 Warbond, limited) on the way to different targets.
  const offers = [wb(1, 2, 1500, { limited: true }), std(2, 4, 7500), std(2, 5, 12500)];
  const v = todayView(world({ offers, goals: [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }, { name: 'Galaxy', base: 1, target: 5, lock: 'off' }] }), DAY);
  assert.equal(v.buyList.today.length, 1);
  const row = v.buyList.today[0];
  assert.equal(row.count, 2);
  assert.equal(row.countText, 'buy 2');
  assert.deepEqual(row.goals.map((g) => g.goalId), ['c2', 'c1'], 'goals in Today order: priority, then name');
  assert.equal(row.forText, 'for Galaxy, Liberator');
  assert.equal(v.hero.buyCount, 2, 'the headline counts copies');
  assert.equal(v.hero.buyCash, 3000);
  assert.equal(v.buys.length, 2, 'the per-goal list is unchanged');
});

test('a single goal says buy 1 and for which goal', () => {
  const v = todayView(world({ offers: [wb(1, 2, 1500, { limited: true }), std(2, 4, 7500)], goals: [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }] }), DAY);
  assert.equal(v.buyList.today[0].countText, 'buy 1');
  assert.equal(v.buyList.today[0].forText, 'for Liberator');
  assert.equal(v.buyList.today[0].detail, 'cash only · for Liberator');
});

test('payment: Warbonds are cash only, Standard steps accept store credit, and your credit is shown', () => {
  const offers = [wb(1, 2, 1500, { limited: true }), std(2, 4, 7500, { firstSeen: iso(2026, 11, 1) })];
  const finish = world({ offers, goals: [{ name: 'Liberator', base: 1, target: 4, mode: 'finish' }], credit: 2500 });
  const v = todayView(finish, DAY);
  const warbond = [...v.buyList.today, ...v.buyList.norush].find((r) => r.kind === 'warbond');
  const standard = [...v.buyList.today, ...v.buyList.norush].find((r) => r.kind === 'standard');
  assert.equal(warbond.payment, 'cash only');
  assert.equal(standard.payment, 'store credit works');
  // Your credit is said once above the list, not on every row.
  assert.equal(v.buyList.creditLine, 'You have $25 store credit for Standard upgrades');
  assert.ok(![...v.buyList.today, ...v.buyList.norush].some((r) => /credit works ·/.test(r.payment)));
  const noCredit = todayView(world({ offers, goals: [{ name: 'Liberator', base: 1, target: 4, mode: 'finish' }] }), DAY);
  assert.equal(noCredit.buyList.creditLine, null);
  assert.equal([...noCredit.buyList.today, ...noCredit.buyList.norush].find((r) => r.kind === 'standard').payment, 'store credit works');
});

test('a Warbond row shows the Standard price of the same pair when it is known', () => {
  const offers = [wb(1, 2, 500, { limited: true }), std(1, 2, 2500), std(2, 4, 7500)];
  const v = todayView(world({ offers, goals: [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }] }), DAY);
  assert.equal(v.buyList.today[0].standardText, 'Standard is $25');
  assert.equal(v.buyList.today[0].detail, 'cash only · Standard is $25 · for Liberator');
  const without = todayView(world({ offers: [wb(1, 2, 500, { limited: true }), std(2, 4, 7500)], goals: [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }] }), DAY);
  assert.equal(without.buyList.today[0].standardText, null);
});

test('three groups: a limited offer today, an old Warbond with no rush, and a lock as optional', () => {
  const offers = [wb(1, 2, 1500, { limited: true }), std(2, 3, 2500), wb(1, 4, 3000, { firstSeen: iso(2026, 11, 14) }), std(4, 5, 5000)];
  const v = todayView(world({ offers, goals: [{ name: 'Orion', base: 1, target: 3 }, { name: 'Galaxy', base: 1, target: 5, lock: 'off' }] }), DAY);
  assert.deepEqual(rowsOf(v), { today: ['warbond:1-2'], norush: ['warbond:1-4'], optional: ['standard:2-3'] });
  assert.equal(v.buyList.norush[0].onSale, 'on sale since Nov 14');
  assert.equal(v.buyList.optional[0].lock, true);
  assert.match(v.buyList.optional[0].trades[0].text, /^Optional: buy now for \$25 to keep this price\. If Orion's price rises before release, waiting costs the rise; none of your other routes caps it\.$/);
  // Only the Buy-today group is counted in the headline; the others are counted separately.
  assert.equal(v.hero.buyCount, 1);
  assert.equal(v.hero.buyCash, 1500);
  assert.equal(v.hero.nothing, false);
  assert.equal(v.hero.otherLine, 'Also: On sale: 1 · Optional: 1');
  assert.equal(v.buyList.end, "That's all for today.");
});

test('with nothing urgent the list ends with the explicit "nothing else" sentence and the hero says so', () => {
  const v = todayView(world({ offers: [wb(1, 2, 1500, { firstSeen: iso(2026, 11, 14) }), std(2, 4, 7500)], goals: [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }] }), DAY);
  assert.deepEqual(rowsOf(v), { today: [], norush: ['warbond:1-2'], optional: [] });
  assert.equal(v.hero.nothing, true);
  assert.equal(v.hero.buyCount, 0);
  assert.equal(v.hero.nothingWhy, 'no-rush');
  assert.equal(v.buyList.end, "That's everything on offer. None of it has to be bought today.");
  assert.equal(v.hero.otherCount, 1);
  assert.equal(v.hero.otherCash, 1500);
  assert.equal(v.goals[0].status, 'norush');
  assert.equal(v.goals[0].noRushCount, 1);
});

test('a sale event ending within two days moves every on-sale row to Buy today; farther away it only says when it ends', () => {
  const offers = [wb(1, 2, 1500, { firstSeen: iso(2026, 11, 14) }), std(2, 4, 7500)];
  const goals = [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }];
  const ev = (to) => ({ rev: 1, events: [{ id: 'e1', name: 'IAE 2956', from: '2026-11-14', to }] });
  const soon = todayView(world({ offers, goals, saleEvents: ev('2026-11-20') }), DAY);
  // The later Standard step into Liberator is not bought: it is not proven to be sold only during events, and a Warbond
  // can still fill its price range, so it waits for one.
  assert.deepEqual(rowsOf(soon).today, ['warbond:1-2']);
  assert.deepEqual(soon.buyList.today[0].reasonTexts, ['IAE 2956 ends Nov 20']);
  const later = todayView(world({ offers, goals, saleEvents: ev('2026-12-02') }), DAY);
  assert.deepEqual(rowsOf(later).norush, ['warbond:1-2']);
  assert.equal(later.buyList.norush[0].onSale, 'on sale since Nov 14 · sale ends Dec 2');
});

test('an offer that just appeared during a sale event is bought today', () => {
  const offers = [wb(1, 2, 1500, { firstSeen: iso(2026, 11, 19) }), std(2, 4, 7500)];
  const v = todayView(world({ offers, goals: [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }], saleEvents: { rev: 1, events: [{ id: 'e1', name: 'IAE 2956', from: '2026-11-14', to: '2026-12-02' }] } }), DAY);
  assert.deepEqual(rowsOf(v).today, ['warbond:1-2']);
  assert.deepEqual(v.buyList.today[0].reasonTexts, ['new during the sale']);
});

test('a later Standard step whose price is about to rise is a Buy-today row too, and leaves the waiting notices', () => {
  const offers = [std(1, 2, 2500), std(2, 4, 7500)];
  const expected = [std(1, 2, 2500), std(2, 4, 9500)];
  const w = world({ offers, goals: [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }] });
  const v = todayView({ ...w, expected }, DAY);
  assert.deepEqual(rowsOf(v).today, ['standard:2-4']);
  assert.deepEqual(v.buyList.today[0].reasonTexts, ['waiting costs money']);
  assert.equal(v.goals[0].buyCount, 1);
  assert.equal(v.waiting.notices.length, 0);
});

test('your note moves a row: "runs until" 10 days ahead is no rush, "ends soon" is today, and clearing restores it', () => {
  const offers = [wb(1, 2, 1500, { limited: true }), std(2, 4, 7500)];
  const goals = [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }];
  const w = world({ offers, goals });
  const row = todayView(w, DAY).buyList.today[0];
  const apply = (w2, action) => ({ ...w2, overrides: applyAction({ plans: w2.plans, overrides: w2.overrides, saleEvents: w2.saleEvents }, action).overrides });
  const far = todayView(apply(w, offerNoteAction(row, { until: '2026-11-29' })), DAY);
  assert.deepEqual(rowsOf(far), { today: [], norush: ['warbond:1-2'], optional: [] });
  assert.equal(far.buyList.norush[0].onSale, 'runs until Nov 29 (your note)');
  const cleared = todayView(apply(apply(w, offerNoteAction(row, { until: '2026-11-29' })), clearOfferNoteAction(row)), DAY);
  assert.deepEqual(rowsOf(cleared).today, ['warbond:1-2']);
  const calm = world({ offers: [wb(1, 2, 1500, { firstSeen: iso(2026, 11, 14) }), std(2, 4, 7500)], goals });
  const soon = todayView(apply(calm, offerNoteAction(row, { soon: true })), DAY);
  assert.deepEqual(rowsOf(soon).today, ['warbond:1-2']);
  assert.deepEqual(soon.buyList.today[0].reasonTexts, ['you marked it as ending soon']);
});

test("\"Don't lock this goal\" dispatches setLock off for that goal, and the lock row goes away", () => {
  const offers = [std(1, 3, 5000)];
  const w = world({ offers, goals: [{ name: 'Orion', base: 1, target: 3 }] });
  const v = todayView(w, DAY);
  const trade = v.buyList.optional[0].trades[0];
  assert.deepEqual(trade.action, { type: 'setLock', chainId: 'c1', value: 'off' });
  assert.deepEqual(dontLockAction('c1'), trade.action);
  const out = applyAction({ plans: w.plans, overrides: w.overrides, saleEvents: w.saleEvents }, trade.action);
  assert.equal(out.plans.chains.c1.lock, 'off');
  const after = todayView({ ...w, plans: { ...out.plans, rev: 1 } }, DAY);
  assert.deepEqual(rowsOf(after), { today: [], norush: [], optional: [] });
});

test('a Warbond chosen over an equal-cost one from a concept ship carries the tie-break line', () => {
  const ships = [ship(1, 'Start', 5000), ship(2, 'Phoenix', 10000), ship(3, 'Crucible', 10000, true), ship(4, 'Galaxy', 20000)];
  const offers = [std(1, 2, 1000), std(1, 3, 1000), wb(2, 4, 3000, { limited: true, skuId: 1 }), wb(3, 4, 3000, { limited: true, skuId: 2 })];
  const plans = newState();
  addChain(plans, { name: 'Galaxy', base: 1, target: 4 });
  const sh = new Map(ships);
  const app = { data: { ships: sh, offers, owned: [], meta: {}, warbondPrices: null, saleHistory: null }, graph: buildGraph({ offers, owned: [], ships: sh }), plans, overrides: emptyOverrides(), saleEvents: emptySaleEvents(), expected: offers };
  const row = todayView(app, DAY).buyList.today.find((r) => r.kind === 'warbond');
  assert.equal(row.from, 2);
  assert.equal(row.tie, 'Chosen over Crucible → Galaxy (same price): the Crucible is a concept ship and may rise.');
});

test('a pair never shows in two groups: a lock goal and a finish goal into the same ship share one row', () => {
  const offers = [std(2, 3, 2500)];
  const w = world({ offers, goals: [{ name: 'Lock', base: 2, target: 3 }, { name: 'Finish', base: 2, target: 3, mode: 'finish' }] });
  const v = todayView(w, DAY);
  const rows = [...v.buyList.today, ...v.buyList.norush, ...v.buyList.optional].filter((r) => r.from === 2 && r.to === 3);
  assert.equal(rows.length, 1, 'one row for the pair');
  assert.equal(rows[0].bucket, 'today', 'the most urgent of its goals: a finish goal buys now');
  assert.equal(rows[0].count, 1, 'only the goal that needs a copy now counts');
  assert.deepEqual(rows[0].goals.map((g) => g.goalId), ['c2']);
  assert.equal(rows[0].trades.length, 1, 'the lock goal keeps its trade and its "Don\'t lock" switch');
  assert.equal(rows[0].trades[0].goalId, 'c1');
  assert.equal(v.goals.find((g) => g.goalId === 'c1').optionalCount, 1);
  assert.equal(v.goals.find((g) => g.goalId === 'c2').buyCount, 1);
  // Different prices for one pair stay apart.
  const two = world({ offers: [std(2, 3, 2500)], goals: [{ name: 'Finish', base: 2, target: 3, mode: 'finish' }] });
  assert.equal(todayView(two, DAY).buyList.today[0].key, 'standard|2-3|2500');
});

test('the limited-flag note shows once, only when the flag of a listed kind is ignored', () => {
  const offers = [wb(1, 2, 1500, { limited: true }), std(2, 4, 7500)];
  const goals = [{ name: 'Liberator', base: 1, target: 4, lock: 'off' }];
  const ignored = todayView(world({ offers, goals, meta: { limitedShare: { warbond: 1, standard: 0 } } }), DAY);
  assert.equal(ignored.buyList.limitedNote, 'RSI marks nearly every offer as limited, so that mark is ignored here.');
  assert.deepEqual(rowsOf(ignored), { today: [], norush: ['warbond:1-2'], optional: [] });
  const kept = todayView(world({ offers, goals, meta: { limitedShare: { warbond: 0.2, standard: 0 } } }), DAY);
  assert.equal(kept.buyList.limitedNote, null);
  assert.deepEqual(rowsOf(kept).today, ['warbond:1-2']);
  const other = todayView(world({ offers, goals, meta: { limitedShare: { warbond: 0.2, standard: 1 } } }), DAY);
  assert.equal(other.buyList.limitedNote, null, 'the ignored kind is not in the list');
});
