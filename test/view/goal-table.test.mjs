import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalRow, nextSort, sortRows, ariaSort, tableSummary, chainProgress, progressText, urgentChip, shortStart } from '../../app/src/lib/view/goalTable.mjs';
import { setup } from '../support/ladder.mjs';
import { acceptRoute } from '../../src/logic/chains.mjs';
import { sessionFor } from '../../src/logic/session.mjs';
import { buildGraph } from '../../src/logic/planner.mjs';
import { todayView } from '../../app/src/lib/view/today.mjs';

const goal = (o = {}) => ({ goalId: 'c1', name: 'Goal', targetName: 'Liberator', startLine: 'from your Pulse · LTI', status: 'wait', cash: 8500, acceptedCash: null, countedCash: 8500,
  buyCount: 0, noRushCount: 1, optionalCount: 0, waitCount: 3, journey: { bar: { own: 18, now: 0, norush: 1, optional: 0, wait: 3 }, steps: new Array(22).fill(0) }, ...o });

test('a goal row has one price, a progress count and ONE chip: its most urgent state', () => {
  const r = goalRow(goal());
  assert.equal(r.left, 8500);
  assert.deepEqual([r.own, r.total], [18, 22]);
  assert.deepEqual(r.chip, { state: 'norush', count: 1 }, 'On sale beats Wait');
  assert.equal(r.flag, null);
  
});

test('the most urgent chip: Buy now > On sale > Optional > Wait > Owned', () => {
  const c = (o) => urgentChip({ buyCount: 0, noRushCount: 0, optionalCount: 0, waitCount: 0, ...o }, 4);
  assert.deepEqual(c({ buyCount: 2, noRushCount: 1, optionalCount: 1, waitCount: 5 }), { state: 'now', count: 2 });
  assert.deepEqual(c({ noRushCount: 1, optionalCount: 1, waitCount: 5 }), { state: 'norush', count: 1 });
  assert.deepEqual(c({ optionalCount: 3, waitCount: 5 }), { state: 'optional', count: 3 });
  assert.deepEqual(c({ waitCount: 5 }), { state: 'wait', count: 5 });
  assert.deepEqual(c({}), { state: 'own', count: 4 });
  assert.equal(urgentChip({}, 0), null);
});

test('the start text is short; a goal without a starting ship leaves it to the chip', () => {
  assert.equal(shortStart('from your Pulse · LTI'), 'Pulse · LTI');
  assert.equal(shortStart('from Carrack (fixed)'), 'Carrack (fixed)');
  assert.equal(shortStart('needs a starting ship'), null);
  assert.equal(shortStart(null), null);
});

test('progress is owned out of all upgrades of one journey, worded for the panel and the list', () => {
  assert.deepEqual(chainProgress({ bar: { own: 15, wait: 2 }, steps: new Array(17).fill(0) }), { own: 15, total: 17 });
  assert.deepEqual(chainProgress({ bar: { own: 1, wait: 2 } }), { own: 1, total: 3 }, 'no steps: the bar adds up');
  assert.deepEqual(chainProgress(null), { own: 0, total: 0 });
  assert.equal(progressText({ own: 15, total: 17 }), '15 of 17 upgrades owned');
  assert.equal(progressText({ own: 0, total: 1 }), '0 of 1 upgrade owned');
});

test('a reserved goal counts its RESERVED chain in the list, the same chain the panel shows (not the proposed one)', () => {
  const { app, ids: [a] } = setup({ goals: [{ base: 1, target: 3 }] });
  acceptRoute(app.plans, a, sessionFor(app).shared.get(a).route);
  // A cheaper two-step chain appears: the proposal differs from the reserved single step.
  const offers = [...app.data.offers, { from: 1, to: 2, kind: 'warbond', cash: 1000, skuId: 9 }];
  const g = todayView({ ...app, data: { ...app.data, offers }, graph: buildGraph({ offers, owned: [] }), expected: offers }).goals[0];
  assert.equal(g.journey.steps.length, 2, 'Today journey is the proposed chain');
  assert.equal(g.counted.steps.length, 1, 'the counted journey is the reserved chain');
  const r = goalRow(g);
  assert.equal(r.total, 1);
  assert.equal(r.left, g.acceptedCash);
  assert.deepEqual(chainProgress(g.counted), { own: r.own, total: r.total }, 'list and panel use one helper on one journey');
  // Without a reservation the counted journey is the proposed one.
  const free = setup({ goals: [{ base: 1, target: 3 }] }).app;
  assert.equal(todayView(free).goals[0].counted, todayView(free).goals[0].journey);
});

test('a reserved goal shows its reserved price (the one the planned total adds up) and remembers today\'s', () => {
  const r = goalRow(goal({ acceptedCash: 5000, countedCash: 5000, cash: 4500 }));
  assert.equal(r.left, 5000);
  assert.equal(r.nowCash, 4500);
  assert.equal(r.reserved, true);
  assert.equal(goalRow(goal({ acceptedCash: 5000, countedCash: 5000, cash: 5000 })).nowCash, null);
});

test('goals without a route or starting ship have no price and say why; a finished goal says so', () => {
  assert.deepEqual(goalRow(goal({ status: 'no-route', cash: null, countedCash: null })).flag, { text: 'No route', tone: 'warn' });
  assert.equal(goalRow(goal({ status: 'no-token', cash: 100, countedCash: 100 })).left, null);
  assert.equal(goalRow(goal({ status: 'no-token' })).flag.text, 'Needs a starting ship');
  assert.equal(goalRow(goal({ status: 'done', cash: 0, countedCash: 0 })).flag.tone, 'own');
});

test('sorting: the first click starts the natural direction, then flips, then clears; goals without a value stay last', () => {
  assert.deepEqual(nextSort(null, 'left'), { key: 'left', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'left', dir: 'asc' }, 'left'), { key: 'left', dir: 'desc' });
  assert.equal(nextSort({ key: 'left', dir: 'desc' }, 'left'), null);
  assert.deepEqual(nextSort(null, 'progress'), { key: 'progress', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'left', dir: 'desc' }, 'progress'), { key: 'progress', dir: 'desc' });
  const rows = [goalRow(goal({ goalId: 'a', countedCash: 300 })), goalRow(goal({ goalId: 'b', status: 'no-route' })), goalRow(goal({ goalId: 'c', countedCash: 100 }))];
  assert.deepEqual(sortRows(rows, null).map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(sortRows(rows, { key: 'left', dir: 'asc' }).map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(rows, { key: 'left', dir: 'desc' }).map((r) => r.id), ['a', 'c', 'b']);
  assert.equal(ariaSort({ key: 'left', dir: 'asc' }, 'left'), 'ascending');
  assert.equal(ariaSort({ key: 'left', dir: 'asc' }, 'progress'), 'none');
});

test('the summary line next to the planned total', () => {
  assert.equal(tableSummary(10, 0), '10 goals · nothing to buy today');
  assert.equal(tableSummary(1, 2), '1 goal · 2 to buy today');
});

test('a reserved goal with a cheaper proposed chain says how much switching would save', () => {
  assert.equal(goalRow(goal({ acceptedCash: 5000, cash: 4500, countedCash: 5000 })).cheaperBy, 500);
  assert.equal(goalRow(goal({ acceptedCash: 5000, cash: 5500, countedCash: 5000 })).cheaperBy, null, 'dearer: no marker');
  assert.equal(goalRow(goal({ acceptedCash: null, cash: 4500 })).cheaperBy, null, 'not reserved: nothing to switch from');
});

test('the chip counts the chain the bar and price count (the reserved one), not the proposal', () => {
  const g = goal({
    acceptedCash: 5000, countedCash: 5000, cash: 4500,
    // The proposed chain (what Today's counts describe): 1 buy now, 3 wait.
    buyCount: 1, noRushCount: 0, optionalCount: 0, waitCount: 3, journey: { bar: { own: 14, now: 1, norush: 0, optional: 0, wait: 3 }, steps: new Array(18).fill(0) },
    // The reserved chain: nothing to buy now, 2 wait.
    counted: { bar: { own: 15, now: 0, norush: 0, optional: 0, wait: 2 }, steps: new Array(17).fill(0) },
  });
  const r = goalRow(g);
  assert.deepEqual(r.chip, { state: 'wait', count: 2 });
  assert.deepEqual([r.own, r.total], [15, 17]);
  assert.equal(r.chip.count, r.bar.wait, 'the chip and the bar beside it agree');
});
