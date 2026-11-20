import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warbondCanFit, minWarbondGap, slotShips } from '../src/logic/warbondFit.mjs';

test('a Warbond fits a step only when the gap reaches the band of the target price', () => {
  assert.equal(minWarbondGap(9500), 1000);
  assert.equal(minWarbondGap(10000), 1500);
  assert.equal(minWarbondGap(19999), 1500);
  assert.equal(minWarbondGap(20000), 2000);
  assert.equal(minWarbondGap(40000), 3000);
  // $5 apart under $200: "no saving" (a Warbond there is discounted by more than the gap).
  assert.equal(warbondCanFit(14000, 14500), false);
  assert.equal(warbondCanFit(13000, 14500), true);
  assert.equal(warbondCanFit(8000, 9000), true);
  assert.equal(warbondCanFit(8500, 9000), false);
  assert.equal(warbondCanFit(38500, 40000), false);
  assert.equal(warbondCanFit(37000, 40000), true);
  assert.equal(warbondCanFit(null, 9000), null);
});

test('slotShips lists sold ships above the start up to the target, nearest the target first', () => {
  const ships = new Map([
    [1, { id: 1, name: 'Start', msrp: 10000 }], [2, { id: 2, name: 'Mid', msrp: 12000 }], [3, { id: 3, name: 'Gone', msrp: 13000, standard: false }],
    [4, { id: 4, name: 'Near', msrp: 14000 }], [5, { id: 5, name: 'Target', msrp: 15000 }], [6, { id: 6, name: 'Above', msrp: 16000 }], [7, { id: 7, name: 'NoPrice' }],
  ]);
  assert.deepEqual(slotShips(ships, 10000, 15000), { count: 3, examples: [{ id: 5, name: 'Target' }, { id: 4, name: 'Near' }, { id: 2, name: 'Mid' }] });
  assert.equal(slotShips(ships, 10000, 15000, 1).examples.length, 1);
  assert.deepEqual(slotShips(null, 0, 1), { count: 0, examples: [] });
});
