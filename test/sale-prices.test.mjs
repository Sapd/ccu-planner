import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordWarbondPrices, seenSalePrice } from '../src/logic/salePrices.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { readRaw } from '../src/data.mjs';

const IAE_EVENT = { name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }; // the sale these fixtures run in

const warbond = (cash, skuId = 20) => ({ from: 1, to: 2, kind: 'warbond', cash, skuId });
const standard = (cash) => ({ from: 1, to: 2, kind: 'standard', cash, skuId: 10 });
const IAE = { rev: 1, events: [{ id: 'e1', ...IAE_EVENT }] };

test('recordWarbondPrices records a first Warbond price for its pair', () => {
  const next = recordWarbondPrices({ pairs: {} }, [warbond(4000)], '2026-11-18');
  assert.deepEqual(next, { pairs: { '1-2': { cash: 4000, at: '2026-11-18', skuId: 20 } } });
});

test('recordWarbondPrices replaces the price with a later lower one', () => {
  const first = recordWarbondPrices({ pairs: {} }, [warbond(4000)], '2026-11-10');
  const next = recordWarbondPrices(first, [warbond(3500)], '2026-11-18');
  assert.deepEqual(next.pairs['1-2'], { cash: 3500, at: '2026-11-18', skuId: 20 });
});

test('recordWarbondPrices keeps the lowest price when a later one is higher', () => {
  const first = recordWarbondPrices({ pairs: {} }, [warbond(4000)], '2026-11-10');
  const next = recordWarbondPrices(first, [warbond(4500)], '2026-11-18');
  assert.deepEqual(next.pairs['1-2'], { cash: 4000, at: '2026-11-10', skuId: 20 });
});

test('recordWarbondPrices keeps the earlier date on a tie', () => {
  const first = recordWarbondPrices({ pairs: {} }, [warbond(4000)], '2026-11-10');
  const next = recordWarbondPrices(first, [warbond(4000, 21)], '2026-11-18');
  assert.deepEqual(next.pairs['1-2'], { cash: 4000, at: '2026-11-10', skuId: 20 });
});

test('recordWarbondPrices ignores standard offers', () => {
  const next = recordWarbondPrices({ pairs: {} }, [standard(2500), standard(100)], '2026-11-18');
  assert.deepEqual(next, { pairs: {} });
});

test('recordWarbondPrices does not mutate the previous document', () => {
  const prev = recordWarbondPrices({ pairs: {} }, [warbond(4000)], '2026-11-10');
  const before = structuredClone(prev);
  recordWarbondPrices(prev, [warbond(3500), { ...warbond(100), from: 5, to: 6 }], '2026-11-18');
  assert.deepEqual(prev, before);
});

test('seenSalePrice names the sale event that covers the day the price was seen', () => {
  const prices = { pairs: { '1-2': { cash: 3500, at: '2026-11-18', skuId: 20 } } };
  assert.deepEqual(seenSalePrice(prices, 1, 2, IAE), {
    cash: 3500, at: '2026-11-18', event: { name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' },
  });
});

test('seenSalePrice has no event when no entered sale event covers the day', () => {
  const prices = { pairs: { '1-2': { cash: 3500, at: '2026-11-18', skuId: 20 } } };
  assert.deepEqual(seenSalePrice(prices, 1, 2, { rev: 0, events: [] }), { cash: 3500, at: '2026-11-18', event: null });
  assert.deepEqual(seenSalePrice(prices, 1, 2, null), { cash: 3500, at: '2026-11-18', event: null });
});

test('seenSalePrice gives null for a pair never seen', () => {
  assert.equal(seenSalePrice({ pairs: {} }, 1, 2, IAE), null);
  assert.equal(seenSalePrice(null, 1, 2, IAE), null);
});

test('buildPlannerData passes the Warbond price record through as data.warbondPrices', () => {
  const warbondPrices = { pairs: { '1-2': { cash: 3500, at: '2026-11-18', skuId: 20 } } };
  const raw = { catalog: { fetchedAt: 'C', ships: [] }, details: null, upgrades: [], hangar: null, buyback: null, history: '', warbondPrices };
  assert.deepEqual(buildPlannerData(raw, { items: {} }).warbondPrices, warbondPrices);
  assert.equal(buildPlannerData({ ...raw, warbondPrices: undefined }, { items: {} }).warbondPrices, null);
});

test('readRaw loads warbond-prices.json and defaults to no pairs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-warbond-raw-'));
  fs.writeFileSync(path.join(dir, 'catalog.json'), '{"ships":[]}');
  assert.deepEqual(readRaw(dir).warbondPrices, { pairs: {} });
  fs.writeFileSync(path.join(dir, 'warbond-prices.json'), '{"pairs":{"1-2":{"cash":3500,"at":"2026-11-18","skuId":20}}}');
  assert.deepEqual(readRaw(dir).warbondPrices, { pairs: { '1-2': { cash: 3500, at: '2026-11-18', skuId: 20 } } });
});
