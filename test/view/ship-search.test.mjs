import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchShips } from '../../app/src/lib/view/shipSearch.mjs';

const ships = new Map([
  [1, { id: 1, name: 'Galaxy', msrp: 40000 }],
  [2, { id: 2, name: 'Pulse', msrp: 15000 }],
  [3, { id: 3, name: 'C1 Spirit', msrp: 7500 }],
  [4, { id: 4, name: 'Hull A', msrp: 6000 }],
  [5, { id: 5, name: 'Intergalactic Cruiser', msrp: 1000 }],
  [6, { id: 6, name: 'Galaxy Mk2', msrp: 30000 }],
]);

test('gal: exact/prefix before substring, then msrp ascending', () => {
  const r = searchShips(ships, 'gal').map((s) => s.name);
  assert.deepEqual(r, ['Galaxy Mk2', 'Galaxy', 'Intergalactic Cruiser']);
  assert.equal(searchShips(ships, 'galaxy')[0].name, 'Galaxy');
});

test('c1 finds C1 Spirit', () => {
  assert.equal(searchShips(ships, 'c1')[0].name, 'C1 Spirit');
});

test('empty query returns nothing; limit applies', () => {
  assert.deepEqual(searchShips(ships, ''), []);
  assert.deepEqual(searchShips(ships, '   '), []);
  assert.equal(searchShips(ships, 'a', 2).length, 2);
});

import { parseCreditUsd, parseBounded } from '../../app/src/lib/view/explorer.mjs';

test('parseCreditUsd: empty is 0 (not null), invalid is null', () => {
  assert.equal(parseCreditUsd(''), 0);
  assert.equal(parseCreditUsd(null), 0);
  assert.equal(parseCreditUsd('12.5'), 1250);
  assert.equal(parseCreditUsd('abc'), null);
  assert.equal(parseCreditUsd('-3'), null);
});

test('parseBounded', () => {
  assert.equal(parseBounded('3', 1, 5), 3);
  assert.equal(parseBounded('6', 1, 5), null);
  assert.equal(parseBounded('', 1, 5), null);
});

import { noRouteMessage } from '../../src/logic/describe.mjs';

test('noRouteMessage has both variants', () => {
  assert.equal(noRouteMessage('Galaxy', 0), 'No route: RSI currently offers no upgrade to Galaxy, and you own no CCU into it.');
  assert.equal(noRouteMessage('Galaxy', 2), 'No route found with the current offers and owned CCUs.');
});
