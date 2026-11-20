import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOKENS, tokenCopyId, ltiShips, tokenPool, tokenSettings } from '../src/logic/tokens.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { buildGraph } from '../src/logic/planner.mjs';

const ships = new Map([
  [1, { id: 1, name: 'Pulse', msrp: 3000 }],
  [2, { id: 2, name: 'Ursa Medivac', msrp: 6000 }],
  [3, { id: 3, name: 'Polaris', msrp: 97500 }],
  [4, { id: 4, name: 'Reliant Mako', msrp: 4500 }],
]);
const item = (title, kind, liner = null) => ({ title, kind, liner });
const pledge = (pledgeId, name, items, value = { cents: 3000, currency: 'USD' }) => ({ pledgeId, name, value, items, upgrade: null });
const entry = (p) => ({ data: p, firstSeen: '2026-01-01', lastSeen: '2026-11-01' });
const hangarOf = (...pledges) => ({ entries: Object.fromEntries(pledges.map((p) => [String(p.pledgeId), entry(p)])), lastSync: null, lastFullSync: null });

const pulseLti = pledge(101, 'Standalone Ship - Pulse', [item('Pulse', 'Ship', 'Roberts Space Industries (RSI)'), item('Lifetime Insurance', 'Insurance')], { cents: 3000, currency: 'USD' });
const medivacLti = pledge(102, 'Standalone Ship - Ursa Medivac', [item('Ursa Medivac', 'Ship'), item('Lifetime Insurance', 'Insurance')], { cents: 5000, currency: 'USD' });
const polarisLti = pledge(103, 'Standalone Ship - Polaris', [item('Polaris', 'Ship'), item('Lifetime Insurance', 'Insurance')], { cents: 90000, currency: 'USD' });
const pulse120 = pledge(104, 'Standalone Ship - Pulse', [item('Pulse', 'Ship'), item('120 Month Insurance', 'Insurance')]);
const pack = pledge(105, 'Package - Pulse Starter', [item('Pulse', 'Ship'), item('Star Citizen Digital Download'), item('Lifetime Insurance', 'Insurance')]);
const twoShips = pledge(106, 'Bundle - Pulse and Ursa', [item('Pulse', 'Ship'), item('Ursa Medivac', 'Ship'), item('Lifetime Insurance', 'Insurance')]);
const unknownShip = pledge(107, 'Standalone Ship - Mystery', [item('Mystery Hauler', 'Ship'), item('Lifetime Insurance', 'Insurance')]);
const makoLti = pledge(108, 'Standalone Ship - Reliant Mako', [item('Reliant Mako', 'Ship'), item('Lifetime Insurance', 'Insurance')], { cents: 4000, currency: 'EUR' });

test('ltiShips keeps a Lifetime Insurance ship pledge and drops the other kinds', () => {
  const out = ltiShips(hangarOf(pulseLti, pulse120, pack, twoShips, unknownShip), ships, null);
  assert.deepEqual(out, [
    { pledgeId: '101', ship: 1, name: 'Pulse', paidCents: 3000, msrpCents: 3000 },
  ]);
});

test('ltiShips returns [] for an empty or missing hangar', () => {
  assert.deepEqual(ltiShips({ entries: {} }, ships), []);
  assert.deepEqual(ltiShips(undefined, ships), []);
});

test('ltiShips drops a gone pledge and resolves a reviewed alias name', () => {
  const gone = { entries: { '101': { ...entry(pulseLti), goneSince: '2026-10-01' } } };
  assert.deepEqual(ltiShips(gone, ships), []);
  const aliased = pledge(109, 'Standalone Ship - Pulse Variant', [item('Pulse Variant X', 'Ship'), item('Lifetime Insurance', 'Insurance')]);
  const aliases = { items: { 7: { shipId: 1, itemName: 'Pulse Variant X', shipName: 'Pulse' } } };
  assert.deepEqual(ltiShips(hangarOf(aliased), ships, aliases).map((x) => x.ship), [1]);
});

test('paidCents is null for a non-USD pledge value', () => {
  const [row] = ltiShips(hangarOf(makoLti), ships);
  assert.equal(row.paidCents, null);
  assert.equal(row.msrpCents, 4500);
});

test('tokenPool with the defaults keeps Pulse and Ursa Medivac and drops Polaris', () => {
  const lti = ltiShips(hangarOf(pulseLti, medivacLti, polarisLti), ships);
  const pool = tokenPool(lti, tokenSettings({ profile: {} }));
  assert.deepEqual(pool.map((x) => x.name), ['Pulse', 'Ursa Medivac']);
});

test('use admits an over-limit pledge; never drops a within-limit one', () => {
  const lti = ltiShips(hangarOf(pulseLti, polarisLti), ships);
  const polarisId = String(polarisLti.pledgeId);
  const pulseId = String(pulseLti.pledgeId);
  assert.deepEqual(tokenPool(lti, { ...DEFAULT_TOKENS, use: [polarisId] }).map((x) => x.name), ['Pulse', 'Polaris']);
  assert.deepEqual(tokenPool(lti, { ...DEFAULT_TOKENS, never: [pulseId] }).map((x) => x.name), []);
});

test('never wins over use for the same pledge', () => {
  const lti = ltiShips(hangarOf(pulseLti), ships);
  assert.deepEqual(tokenPool(lti, { ...DEFAULT_TOKENS, use: ['101'], never: ['101'] }), []);
});

test('use on a pledge whose ship is not in the catalog has no effect', () => {
  const lti = ltiShips(hangarOf(unknownShip, pulseLti), ships);
  assert.deepEqual(tokenPool(lti, { ...DEFAULT_TOKENS, use: ['107'] }).map((x) => x.pledgeId), ['101']);
});

test('the pool is sorted by paidCents ascending, null last, then pledgeId', () => {
  const lti = ltiShips(hangarOf(makoLti, medivacLti, pulseLti, pledge(110, 'Standalone Ship - Pulse', [item('Pulse', 'Ship'), item('Lifetime Insurance', 'Insurance')], { cents: 5000, currency: 'USD' })), ships);
  const pool = tokenPool(lti, DEFAULT_TOKENS);
  assert.deepEqual(pool.map((x) => x.pledgeId), ['101', '102', '110', '108']);
});

test('tokenSettings with an empty profile deep-equals the defaults', () => {
  assert.deepEqual(tokenSettings({ profile: {} }), DEFAULT_TOKENS);
  assert.deepEqual(DEFAULT_TOKENS, { limitCents: 8000, use: [], never: [] });
});

test('tokenCopyId prefixes the pledge id', () => {
  assert.equal(tokenCopyId('101'), 'token:101');
});

test('buildPlannerData exposes lti, and buildGraph carries it on the graph', () => {
  const raw = { catalog: { fetchedAt: null, ships: [{ id: 1, name: 'Pulse', msrp: 3000 }] }, details: null, upgrades: [], hangar: hangarOf(pulseLti, pulse120), buyback: null, history: '' };
  const data = buildPlannerData(raw, null);
  assert.deepEqual(data.lti.map((t) => t.pledgeId), ['101']);
  assert.deepEqual(buildGraph({ offers: [], owned: [], lti: data.lti }).lti, data.lti);
  assert.deepEqual(buildGraph({ offers: [] }).lti, []);
});

test('tokenSettings returns copies of the list arrays', () => {
  const s = tokenSettings({ profile: {} });
  s.use.push('x');
  s.never.push('y');
  assert.deepEqual(DEFAULT_TOKENS, { limitCents: 8000, use: [], never: [] });
  const stored = { profile: { tokens: { use: ['a'] } } };
  tokenSettings(stored).use.push('b');
  assert.deepEqual(stored.profile.tokens.use, ['a']);
});
