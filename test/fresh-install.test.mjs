// A first run end to end: an empty data folder, a store sync, a hangar sync, then the planner. RSI names hangar items its own way
// ("Hercules Starlifter M2", "600i Exploration Module"), so owned upgrades map only through the store's ship details (item IDs) or
// the pledge title. Guards the bug where a first sync never fetched details and the plan bought a Warbond the user already owned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sync } from '../src/sync/core.mjs';
import { validateRequest } from '../src/sync/policy.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { buildGraph, planRoutes } from '../src/logic/planner.mjs';

const ship = (id, name, msrp) => ({ id, name, manufacturer: 'Test', flyableStatus: 'Flyable', owned: false, msrp, skus: [{ id: id * 1000 }] });
const catalog = { fetchedAt: '2026-11-20', app: { pricing: { currencyCode: 'USD', taxRate: 0 } }, manufacturers: [], ships: [
  ship(1, 'Prowler', 44000), ship(2, '600i Explorer', 47500), ship(3, 'M2 Hercules', 52000), ship(4, 'Liberator', 60000),
] };
// The store: a $85 Warbond Prowler -> Liberator and Standard steps. Details carry each ship's own item ID.
const store = {
  1: [{ id: 2, skus: [{ id: 102, available: true, upgradePrice: 35 }] }, { id: 3, skus: [{ id: 103, available: true, upgradePrice: 80 }] }, { id: 4, skus: [{ id: 104, available: true, upgradePrice: 85 }] }],
  2: [{ id: 3, skus: [{ id: 203, available: true, upgradePrice: 45 }] }],
  3: [{ id: 4, skus: [{ id: 304, available: true, upgradePrice: 80 }] }],
};
const details = {
  2: [{ id: 102, title: 'Standard Edition', items: [{ id: 5944, title: '600i Exploration Module' }] }],
  3: [{ id: 103, title: 'Standard Edition', items: [{ id: 7643, title: 'Hercules Starlifter M2' }] }, { id: 203, title: 'Standard Edition', items: [{ id: 7643, title: 'Hercules Starlifter M2' }] }],
  4: [{ id: 104, title: 'Upgrade - Prowler to Liberator Warbond Edition', items: [{ id: 54779, title: 'Liberator' }] }, { id: 304, title: 'Standard Edition', items: [{ id: 54779, title: 'Liberator' }] }],
};
const esc = (v) => JSON.stringify(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const pledge = (id, name, match, target) => `<li><input class="js-pledge-id" value="${id}"><input class="js-pledge-name" value="${name}"><input class="js-pledge-value" value="$5.00 USD">`
  + `<input class="js-upgrade-data" value="${esc({ id, name, match_items: match, target_items: target, upgrade_type: 'R' })}"></li>`;
const hangar = (names) => `<html><head><title>My Hangar</title></head><body><ul class="list-items">${[
  pledge(11, names[0], [{ id: 3938, name: 'Prowler' }], [{ id: 5944, name: '600i Exploration Module' }, { id: 5943, name: '600i Name Reservation' }]),
  pledge(12, names[1], [{ id: 5944, name: '600i Exploration Module' }], [{ id: 7643, name: 'Hercules Starlifter M2' }, { id: 11437, name: '120 Month Insurance' }]),
  pledge(13, names[2], [{ id: 7643, name: 'Hercules Starlifter M2' }], [{ id: 54779, name: 'Liberator' }, { id: 11437, name: '120 Month Insurance' }]),
].join('')}</ul></body></html>`;

function rsi(hangarHtml) {
  return async ({ method, path, body }) => {
    validateRequest(method, path, body);
    if (method === 'GET') return /page=1(&|$)/.test(path) ? hangarHtml : '<html><head><title>My Hangar</title></head><body><ul class="list-items"></ul></body></html>';
    return body.map(({ operationName, variables }) => {
      if (operationName === 'initShipUpgrade') return { data: catalog };
      if (operationName === 'getShipDetails') return { data: { ship: { skus: details[variables.id] ?? [] } } };
      if (!variables.fromId) return { data: { from: { ships: Object.keys(store).map((id) => ({ id: Number(id) })) } } };
      return { data: { to: { ships: store[variables.fromId] ?? [] } } };
    });
  };
}
function memory(request) {
  const files = {};
  return { files, request, progress: () => {}, log: () => {},
    readJson: async (name, fallback) => name === 'upgrades'
      ? Object.entries(files).filter(([k]) => /^upgrades\/\d+\.json$/.test(k)).map(([, v]) => structuredClone(v))
      : structuredClone(files[name] ?? fallback),
    writeJson: async (name, value) => { files[name] = structuredClone(value); },
    appendLine: async (name, line) => { files[name] = (files[name] ?? '') + line + '\n'; },
  };
}
async function firstRun(names) {
  const io = memory(rsi(hangar(names)));
  await sync('upgrades', io);
  await sync('hangar', io, { full: true });
  const data = buildPlannerData({
    catalog: io.files['catalog.json'], details: io.files['ship-details.json'] ?? null,
    upgrades: await io.readJson('upgrades', []), hangar: io.files['hangar.json'], history: io.files['offer-history.jsonl'] ?? '',
  }, { items: {} });
  const [best] = planRoutes(buildGraph({ offers: data.offers, owned: data.owned, ships: data.ships }), { base: 1, target: 4 }, 1);
  return { io, data, best };
}

test('first run: details are fetched, every owned upgrade maps, and the plan buys nothing the hangar already covers', async () => {
  const { io, data, best } = await firstRun(['Upgrade - Prowler to 600i Explorer Warbond Edition', 'Upgrade - 600i Explorer to M2 Hercules Warbond Edition', 'Upgrade - M2 Hercules to Liberator Warbond Edition']);
  assert.ok(io.files['ship-details.json'], 'a first store sync writes ship-details.json');
  assert.deepEqual(data.review, []);
  assert.deepEqual(data.owned.map((o) => [o.copyId, o.from, o.to]).sort(), [['11', 1, 2], ['12', 2, 3], ['13', 3, 4]]);
  assert.equal(best.cash, 0);
  assert.deepEqual(best.steps.map((s) => s.kind), ['owned', 'owned', 'owned']);
});

test('first run: a ship that is no upgrade target gets no details; its upgrades map by title, or go to review and the banner', async () => {
  const saved = store[1]; store[1] = saved.filter((t) => t.id !== 2);
  try {
    const titled = await firstRun(['Upgrade - Prowler to 600i Explorer Warbond Edition', 'Upgrade - 600i Explorer to M2 Hercules Warbond Edition', 'Upgrade - M2 Hercules to Liberator Warbond Edition']);
    assert.deepEqual(titled.data.review, []);
    assert.equal(titled.best.cash, 0);
    const untitled = await firstRun(['Prowler 600i upgrade', 'Exploration M2 upgrade', 'M2 Liberator upgrade']);
    assert.deepEqual(untitled.data.review.map((r) => [r.pledgeId, r.fromShip, r.toShip]), [[11, 1, null], [12, null, 3]]);
  } finally { store[1] = saved; }
});

test('first run: item IDs from details alone map upgrades whose titles are not in the store format', async () => {
  const { data, best } = await firstRun(['Prowler 600i upgrade', 'Exploration M2 upgrade', 'M2 Liberator upgrade']);
  assert.deepEqual(data.review, []);
  assert.ok(data.owned.every((o) => o.matchMethod === 'item-id' || o.matchMethod === 'name'), JSON.stringify(data.owned.map((o) => o.matchMethod)));
  assert.equal(best.cash, 0);
});
