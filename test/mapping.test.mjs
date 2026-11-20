import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { shipName } from '../src/logic/ships.mjs';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/raw-small.json', import.meta.url), 'utf8'));
const aliases = { items: {} };

test('maps ships, store offers (kind from SKU title) and owned CCUs from raw data', () => {
  const data = buildPlannerData(raw, aliases);
  assert.equal(data.ships.get(2).concept, true);
  assert.equal(data.ships.get(1).concept, false);

  assert.equal(data.offers.length, 2);
  const byTo = Object.fromEntries(data.offers.map((o) => [o.to, o.kind]));
  assert.deepEqual(byTo, { 2: 'standard', 3: 'warbond' });
  assert.equal(data.meta.inferredKinds, 0);

  assert.equal(data.owned.length, 1);
  assert.equal(data.owned[0].matchMethod, 'item-id');
  assert.equal(data.owned[0].from, 1);
  assert.equal(data.owned[0].to, 2);

  // Mystery CCU has no resolvable items; "Nope" names no ship. The melted
  // (goneSince) and ship-only (upgrade null) entries are skipped entirely.
  assert.equal(data.review.length, 2);
  assert.deepEqual(data.buyback.length, 1);
});

test('without ship details the offer kind is inferred from the msrp difference', () => {
  const data = buildPlannerData({ ...raw, details: null, history: '', buyback: null }, aliases);
  assert.equal(data.offers.length, 2);
  assert.equal(data.meta.inferredKinds, 2);
  assert.deepEqual(data.buyback, []);
});

test('shipName says "unknown ship" for a ship that is not in the catalog', () => {
  const data = buildPlannerData(raw, aliases);
  assert.equal(shipName(data.ships, 99), 'unknown ship');
  assert.equal(shipName(data.ships, 2), 'Beta');
});
