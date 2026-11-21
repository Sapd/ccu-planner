import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlannerData, titleShips } from '../src/logic/mapping.mjs';
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

// A hangar entry whose items RSI names its own way; the title carries the store names.
const withEntry = (pledgeId, name, match, target) => ({
  ...raw,
  hangar: { entries: { ...raw.hangar.entries, [pledgeId]: { data: { pledgeId, name, value: { cents: 500, currency: 'USD' }, canGift: false, canReclaim: true, upgrade: { name, match_items: match, target_items: target } } } } },
});

test('an upgrade whose items do not resolve maps by the exact store names in its title', () => {
  const data = buildPlannerData(withEntry(9100, 'Upgrade - Gamma to Beta Warbond Edition',
    [{ id: 8001, name: 'Gamma Starlifter' }], [{ id: 8002, name: 'Beta Hauler' }, { id: 11437, name: '120 Month Insurance' }]), aliases);
  const copy = data.owned.find((o) => o.copyId === '9100');
  assert.deepEqual([copy.from, copy.to, copy.matchMethod, copy.edition], [3, 2, 'title', 'Warbond']);
  assert.deepEqual(copy.extras, ['120 Month Insurance']);
  assert.ok(!data.review.some((r) => r.pledgeId === 9100));
});

test('a title that names other ships than the resolved items goes to review, with the side that resolved', () => {
  const data = buildPlannerData(withEntry(9101, 'Upgrade - Gamma to Beta Standard Edition',
    [{ id: 1001, name: 'Alpha Module' }], [{ id: 8002, name: 'Beta Hauler' }]), aliases);
  assert.ok(!data.owned.some((o) => o.copyId === '9101'));
  const r = data.review.find((x) => x.pledgeId === 9101);
  assert.match(r.reason, /title name different ships/);
  assert.equal(r.unknownShip, undefined);
  assert.deepEqual([r.fromShip, r.toShip], [1, null]);
});

test('an upgrade reward into a ship absent from the upgrade tool stays in review with its ship name', () => {
  const reward = withEntry(9102, 'F7A Hornet Mk II Upgrade',
    [{ id: 3900, name: 'F7C Hornet Mk II' }],
    [{ id: 11437, name: '120 Month Insurance' }, { id: 3918, name: 'F7A Hornet Mk II' }]);
  const f7c = { id: 270, name: 'F7C Hornet Mk II', msrp: 17500, skus: [] };
  const data = buildPlannerData({ ...reward, catalog: { ...reward.catalog, ships: [...reward.catalog.ships, f7c] } }, aliases);
  const r = data.review.find((item) => item.pledgeId === 9102);
  assert.deepEqual([r.fromShip, r.toShip, r.unknownShip], [270, null, 'F7A Hornet Mk II']);
  assert.equal(r.reason, 'RSI’s upgrade tool does not sell F7A Hornet Mk II. Plans cannot use this upgrade.');
  assert.ok(!data.owned.some((o) => o.copyId === '9102'));
});

test('review keeps the usual warning reason for multiple matches or a side with extras only', () => {
  const multi = withEntry(9103, 'Other Upgrade',
    [{ id: 1001, name: 'Alpha Module' }, { id: 2001, name: 'Beta Module' }], [{ id: 3918, name: 'F7A Hornet Mk II' }]);
  const extras = withEntry(9104, 'Other Upgrade',
    [{ id: 1001, name: 'Alpha Module' }], [{ id: 11437, name: '120 Month Insurance' }]);
  for (const [id, fixture] of [[9103, multi], [9104, extras]]) {
    const r = buildPlannerData(fixture, aliases).review.find((item) => item.pledgeId === id);
    assert.equal(r.unknownShip, undefined);
    assert.match(r.reason, /^from matches/);
  }
});

test('titleShips accepts only one exact split and never a similar name', () => {
  const byName = new Map([['alpha', 1], ['beta to go', 2], ['beta', 3], ['go', 4], ['twin', null]]);
  assert.deepEqual(titleShips('Upgrade - Alpha to Beta Warbond Edition', byName), { from: 1, to: 3 });
  assert.deepEqual(titleShips('Upgrade - Alpha to Beta to Go Standard Edition', byName), { from: 1, to: 2 });
  assert.equal(titleShips('Upgrade - Beta to Go to Beta Warbond Edition', new Map([['beta', 3], ['go to beta', 5], ['beta to go', 2]])), null); // two readings
  assert.equal(titleShips('Upgrade - Alpha to Bet Warbond Edition', byName), null);
  assert.equal(titleShips('Upgrade - Alpha to Twin Warbond Edition', byName), null); // ambiguous store name
  assert.equal(titleShips('F7A Hornet Mk II Upgrade', byName), null);
});
