import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { sync } from '../src/sync/core.mjs';
import { validateRequest } from '../src/sync/policy.mjs';
import { QUERIES } from '../src/sync/queries.mjs';
import { createSyncRunner } from '../app/dev-sync.js';
import { appDataDir } from '../src/data.mjs';
import { shipThumbs } from '../src/logic/images.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/raw-small.json', import.meta.url)));
function memory(initial = {}, request = async () => '') {
  const files = structuredClone(initial), events = [], logs = [];
  return { files, events, logs, request,
    readJson: async (name, fallback) => name === 'upgrades'
      ? Object.entries(files).filter(([k]) => /^upgrades\/\d+\.json$/.test(k)).map(([,v]) => structuredClone(v))
      : structuredClone(files[name] ?? fallback),
    writeJson: async (name, value) => { files[name] = structuredClone(value); },
    appendLine: async (name, line) => { files[name] = (files[name] ?? '') + line + '\n'; },
    progress: (e) => events.push(e), log: (l) => logs.push(l),
  };
}
// Answers every query of a (batched) request in order, like RSI; sources = the ship ids filterShips lists.
function storeRequest(seen, onSource = () => {}, sources = [1, 2, 3], sent = []) {
  return async ({ method, path, body }) => {
    validateRequest(method, path, body);
    sent.push(body.map((op) => op.operationName));
    return body.map((op) => {
      if (op.operationName === 'initShipUpgrade') return { data: { ...fixture.catalog, app: { pricing: { currencyCode: 'USD', taxRate: 0 } } } };
      if (op.operationName === 'getShipDetails') return { data: { ship: { skus: fixture.details.details[op.variables.id]?.skus ?? [] } } };
      if (!op.variables.fromId) return { data: { from: { ships: sources.map((id) => ({ id })) } } };
      const id = op.variables.fromId; seen.push(id); onSource(id);
      return { data: { to: { ships: [{ id: 3, skus: [{ id: 5002, available: true, upgradePrice: 2000 }] }] } } };
    });
  };
}

test('JS transport refuses purchase/melt/gift/apply/redeem/cart and substituted queries before fetch', () => {
  for (const path of ['/api/purchase', '/api/melt', '/api/gift', '/api/apply', '/pledge/buyback/1', '/api/cart', '/en/account/pledges/../cart?x', '/en/account/pledges?%2f']) {
    for (const method of ['GET','POST','PUT','DELETE']) assert.throws(() => validateRequest(method, path, {}));
  }
  for (const operationName of ['purchase','melt','gift','applyUpgrade','redeemBuyback','addToCart','getPrice']) {
    assert.throws(() => validateRequest('POST', '/pledge-store/api/upgrade/v2/graphql', [{ operationName, query: 'mutation { buy }' }]));
  }
  for (const [operationName, query] of Object.entries(QUERIES)) validateRequest('POST', '/pledge-store/api/upgrade/v2/graphql', [{ operationName, query }]);
  const op = { operationName: 'filterShips', query: QUERIES.filterShips, variables: { fromId: 1 } };
  validateRequest('POST', '/pledge-store/api/upgrade/v2/graphql', Array(5).fill(op));
  assert.throws(() => validateRequest('POST', '/pledge-store/api/upgrade/v2/graphql', Array(6).fill(op)), /not allowlisted/);
  assert.throws(() => validateRequest('POST', '/api/ship-upgrades/setContextToken', { pledgeId: 1 }));
});

test('cancelled store sync resumes after last finished source, persists history, details and Warbond prices', async () => {
  // Six sources: the cancel during the first batch of five takes effect before the next request.
  const sources = [1, 2, 3, 4, 5, 6];
  let cancelled = false;
  const seen = [];
  const io = memory({ 'upgrades/1.json': { fetchedAt: '2026-01-01', fromId: 1, targets: [] } }, storeRequest(seen, () => cancelled = true, sources));
  await assert.rejects(sync('upgrades', io, { cancelled: () => cancelled }), /cancelled/);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(io.files['sync-state.json'].lastFinished, 5);
  assert.match(io.files['offer-history.jsonl'], /appeared/);
  io.request = storeRequest(seen, () => {}, sources);
  await sync('upgrades', io);
  assert.deepEqual(seen, sources);
  assert.equal(io.files['sync-state.json'], null);
  assert.equal(io.files['warbond-prices.json'].pairs['1-3'].cash, 2000);
  assert.equal(io.files['offer-history.jsonl'].trim().split('\n').length, 1);
  assert.ok(io.events.some((e) => e.phase === 'upgrades' && e.done === 6 && e.total === 6));
});

test('the store sync asks for 5 ships per request (the RSI limit); a cancel mid-way resumes after the last finished batch', async () => {
  const sources = Array.from({ length: 12 }, (_, i) => i + 1);
  const seen = [], sent = [];
  let cancelled = false;
  const io = memory({}, storeRequest(seen, (id) => { if (id === 7) cancelled = true; }, sources, sent));
  await assert.rejects(sync('upgrades', io, { cancelled: () => cancelled }), /cancelled/);
  const batches = sent.filter((names) => names[0] === 'filterShips').slice(1); // the first one lists the sources
  assert.deepEqual(batches.map((b) => b.length), [5, 5]);
  assert.equal(io.files['sync-state.json'].lastFinished, 10, 'the whole second batch was saved before the cancel took effect');
  assert.deepEqual(io.events.filter((e) => e.phase === 'upgrades').map((e) => e.done), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  cancelled = false; sent.length = 0;
  io.request = storeRequest(seen, () => {}, sources, sent);
  await sync('upgrades', io);
  assert.deepEqual(sent.filter((names) => names[0] === 'filterShips').slice(1).map((b) => b.length), [2]);
  assert.deepEqual(seen, sources);
  assert.equal(io.files['upgrades/12.json'].fromId, 12);
  assert.ok(sent.every((names) => names.length <= 5));
});

test('a batched answer with a missing result is an error, not a silent gap', async () => {
  const io = memory({}, async ({ method, path, body }) => {
    validateRequest(method, path, body);
    if (body[0].operationName === 'initShipUpgrade') return [{ data: { ...fixture.catalog, app: { pricing: { currencyCode: 'USD', taxRate: 0 } } } }];
    if (!body[0].variables.fromId) return [{ data: { from: { ships: [{ id: 1 }, { id: 2 }] } } }];
    return [{ data: { to: { ships: [] } } }]; // one answer for two queries
  });
  await assert.rejects(sync('upgrades', io), /answered 1 of 2 queries/);
  assert.equal(io.files['upgrades/1.json'], undefined);
});

test('--full ignores resume state; changed source lists safely restart', async () => {
  for (const [options, key] of [[{ full: true }, '[1,2,3]'], [{}, '[99]']]) {
    const seen = [], io = memory({ 'sync-state.json': { key, lastFinished: 2 } }, storeRequest(seen));
    await sync('upgrades', io, options);
    assert.deepEqual(seen, [1,2,3]);
  }
});

const oldHangar = (count) => ({ entries: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { data: {} }])) });
test('hangar: large drop preserves data until confirmed, or --force; small hangars and buyback can shrink', async () => {
  const previous = oldHangar(10);
  const io = memory({ 'hangar.json': previous });
  await assert.rejects(sync('hangar', io, { full: true }), /nothing was changed/);
  assert.deepEqual(io.files['hangar.json'], previous);
  io.confirmOverwrite = async (detail) => {
    assert.deepEqual(detail, { current: 0, previous: 10, message: 'RSI returned 0 of 10 pledges. Overwrite anyway?' });
    return false;
  };
  await assert.rejects(sync('hangar', io, { full: true }), /nothing was changed/);
  assert.deepEqual(io.files['hangar.json'], previous);
  io.confirmOverwrite = async () => true;
  await sync('hangar', io, { full: true });
  assert.ok(Object.values(io.files['hangar.json'].entries).every((e) => e.goneSince));
  for (const [kind, count, options] of [['hangar', 10, { force: true }], ['hangar', 9, {}], ['buyback', 50, {}]]) {
    const other = memory({ [`${kind}.json`]: oldHangar(count) });
    other.confirmOverwrite = () => { throw new Error('should not confirm'); };
    await sync(kind, other, { full: true, ...options });
    assert.ok(Object.values(other.files[`${kind}.json`].entries).every((e) => e.goneSince));
  }
});

test('a sign-in page instead of the hangar is a lost session: nothing is saved', async () => {
  const signinPage = '<html><body><form class="js-signin-form" action="/api/account/v2/signin"><input name="login"></form></body></html>';
  for (const kind of ['hangar', 'buyback']) {
    const io = memory({}, async () => signinPage);
    await assert.rejects(sync(kind, io, { full: true }), /session missing or expired/);
    assert.equal(io.files[`${kind}.json`], undefined, kind);
  }
});

test('RSI\u2019s signed-out "Access denied" page is a lost session, not an empty hangar', async () => {
  const denied = '<html><head><title>Access denied - Roberts Space Industries</title><meta name="csrf-token" content="anon"></head><body>Access denied</body></html>';
  for (const kind of ['hangar', 'buyback']) {
    const io = memory({}, async () => denied);
    await assert.rejects(sync(kind, io, { full: true }), /session missing or expired/);
    assert.equal(io.files[`${kind}.json`], undefined, kind);
    assert.ok(!io.logs.some((l) => /no pledges/.test(l)), kind);
  }
});

test('a hangar with no pledges is saved but warns', async () => {
  const io = memory({}, async () => '<html><body><ul class="list-items"></ul></body></html>');
  await sync('hangar', io, { full: true });
  assert.deepEqual(io.files['hangar.json'].entries, {});
  assert.ok(io.logs.some((l) => /^warning: RSI listed no pledges/.test(l)), io.logs.join('\n'));
  const one = memory({}, async (r) => (r.path.includes('page=1&') ? '<li><input class="js-pledge-id" value="1"><input class="js-pledge-name" value="Alpha"></li>' : ''));
  await sync('hangar', one, { full: true });
  assert.ok(!one.logs.some((l) => /no pledges/.test(l)));
});

test('hangar incremental early stop, full disappearance, and empty first run keep existing formats', async () => {
  const html = '<li><input class="js-pledge-id" value="1"><input class="js-pledge-name" value="Alpha"></li>';
  let calls = 0;
  const io = memory({}, async () => ++calls % 2 ? html : '');
  await sync('hangar', io);
  assert.equal(calls, 2);
  assert.equal(io.files['hangar.json'].entries['1'].data.name, 'Alpha');
  calls = 0;
  await sync('hangar', io);
  assert.equal(calls, 1);
  const empty = memory(); await sync('buyback', empty);
  assert.deepEqual(empty.files['buyback.json'].entries, {});
});

test('dev runner spawns fixed argv, streams split progress, cancels gracefully and reports failures', () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = (signal) => { assert.equal(signal, 'SIGINT'); };
  const runner = createSyncRunner('/tmp/fixture', (exe, args, opts) => {
    assert.equal(exe, process.execPath); assert.deepEqual(args, ['scripts/sync.mjs','upgrades']);
    assert.equal(opts.env.CCU_DATA, '/tmp/fixture'); assert.equal(opts.shell, undefined); return child;
  });
  assert.throws(() => runner.start('upgrades; rm -rf /'), /Unknown/);
  runner.start('upgrades'); assert.throws(() => runner.start('hangar'), /already/);
  child.stdout.emit('data', 'progress {"phase":"upgrades",');
  child.stdout.emit('data', '"done":2,"total":3}\n');
  assert.equal(runner.status().progress.done, 2); runner.cancel();
  child.stderr.emit('data', 'Sign-in expired'); child.emit('close', 1);
  assert.equal(runner.status().error, 'Sign-in expired'); assert.equal(runner.status().running, false);
});

test('the dev runner starts the catalog sync through its own script and refuses other kinds', () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  const runner = createSyncRunner('/tmp/fixture', (exe, args, opts) => {
    assert.deepEqual(args, ['scripts/sync-catalog.mjs']);
    assert.equal(opts.env.CCU_DATA, '/tmp/fixture');
    return child;
  });
  assert.throws(() => runner.start('catalog; rm -rf /'), /Unknown/);
  runner.start('store-catalog', { force: true });
  child.emit('close', 0);
  assert.equal(runner.status().error, null);
});

test('shared data directory matches Tauri platform conventions and originals keep their actual format', () => {
  assert.equal(appDataDir('darwin', {}, '/home/me'), '/home/me/Library/Application Support/eu.sapd.ccuplanner/data');
  assert.equal(appDataDir('linux', { XDG_DATA_HOME: '/data' }, '/home/me'), '/data/eu.sapd.ccuplanner/data');
  assert.equal(appDataDir('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me'), 'C:\\Users\\me\\AppData\\Roaming\\eu.sapd.ccuplanner\\data');
  assert.deepEqual(shipThumbs({ thumbs: { s: '1-original.png', l: '1-original.png' } }, 1), { s: '1-original.png', l: '1-original.png' });
  assert.equal(shipThumbs({ thumbs: { s: '../1-original.png', l: '../1-original.png' } }, 1), null);
});

test('details request list matches the legacy appeared/unknown/available scope on a fixture', async () => {
  const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/sync-details-scope.json', import.meta.url)));
  const requests = [];
  const io = memory({
    'upgrades/1.json': { fetchedAt: '2026-11-19', fromId: 1, targets: sample.before },
    'ship-details.json': { details: { 3: { skus: sample.knownSkus.map((id) => ({ id, title: 'Standard' })) } } },
  }, async ({ body }) => {
    const { operationName, variables } = body[0]; requests.push([operationName, variables]);
    let data;
    if (operationName === 'initShipUpgrade') data = { ...fixture.catalog, app: { pricing: { currencyCode: 'USD', taxRate: 0 } } };
    else if (operationName === 'getShipDetails') data = { ship: { skus: [{ id: 500, title: 'Warbond' }, { id: 501, title: 'Standard' }] } };
    else if (!variables.fromId) data = { from: { ships: [{ id: 1 }] } };
    else data = { to: { ships: sample.after } };
    return [{ data }];
  });
  await sync('upgrades', io);
  assert.deepEqual(requests, sample.legacyRequests);
});

test('resume expires after 24 hours or a local day change, and emits the starting point', async () => {
  const now = new Date(2026, 10, 19, 16, 30);
  const cases = [
    [new Date(2026, 10, 19, 15, 30), [2, 3], true],
    [new Date(2026, 10, 18, 23, 59), [1, 2, 3], false],
    [new Date(now - 86400000), [1, 2, 3], false],
    [new Date(now.getTime() + 1000), [1, 2, 3], false],
  ];
  for (const [started, expected, resumes] of cases) {
    const seen = [];
    const io = memory({ 'sync-state.json': { key: '[1,2,3]', lastFinished: 1, startedAt: started.toISOString() } }, storeRequest(seen));
    await sync('upgrades', io, { now: () => now });
    assert.deepEqual(seen, expected);
    assert.equal(io.logs.some((m) => m === 'Resuming store sync from ship 2 of 3 (started 15:30)'), resumes);
    assert.equal(io.events.some((e) => e.message?.includes('Resuming store sync')), resumes);
  }
});

// ---- the store catalog through the user's session (the desktop app's path) ----
const gqlItem = (id, o = {}) => ({ id: String(id), title: `Item ${id}`, url: `/pledge/Standalone-Ships/Item-${id}`, media: { thumbnail: { storeSmall: `https://media.robertsspaceindustries.com/${id}/s.jpg` } },
  nativePrice: { amount: 5000, discounted: null }, stock: { unlimited: true, available: true, qty: 0 }, tags: [], isWarbond: false, isPackage: false, isVip: false, ...o });
function catalogRequest(seen, byProduct) {
  return async ({ method, path, body }) => {
    validateRequest(method, path, body);
    seen.push({ method, path, products: body.variables.query.skus.products, tag: body.variables.query.skus.filtersFromTags?.tagIdentifiers?.[0] ?? null });
    const list = byProduct[body.variables.query.skus.products[0]] ?? [];
    return { data: { store: { listing: { resources: list, count: list.length, totalCount: list.length } } } };
  };
}

test('store-catalog through the session: pinned POST /graphql only, signedIn is written, Subscriber and Concierge items are kept, pictures come through the host', async () => {
  const seen = [];
  const io = memory({}, catalogRequest(seen, { 72: [gqlItem(1), gqlItem(2, { isVip: true })], 65: [gqlItem(3, { url: '/pledge/Gear/Sub-Hat' })], 289: [gqlItem(4, { url: '/pledge/Gear/Armor' })] }));
  const cached = [];
  io.cacheCatalogImage = async ({ id }) => { cached.push(id); if (id === 2) throw new Error('boom'); return `catalog/${id}.png`; };
  io.listCatalogImages = async () => [];
  await sync('store-catalog', io, { now: () => Date.parse('2026-11-20T10:00:00Z') });
  assert.ok(seen.length > 5 && seen.every((s) => s.method === 'POST' && s.path === '/graphql'));
  const doc = io.files['store-catalog.json'];
  assert.equal(doc.signedIn, true);
  assert.equal(doc.fetchedAt, '2026-11-20T10:00:00.000Z');
  assert.deepEqual(doc.items.map((i) => [i.id, i.category, i.subscriber, i.vip, i.thumb]), [[1, 'ships', false, false, 'catalog/1.png'], [2, 'ships', false, true, null], [4, 'gear', false, false, 'catalog/4.png'], [3, 'gear', true, false, 'catalog/3.png']]);
  assert.deepEqual(doc.categories.ships, { expected: 2, got: 2 });
  assert.deepEqual(doc.items.find((i) => i.id === 4).subs, ['armor', 'clothing', 'equipment']);
  assert.ok(io.logs.some((l) => /1 picture failures/.test(l)));
});

test('store-catalog: without a picture hook only the listing is saved and earlier pictures are kept', async () => {
  const io = memory({ 'store-catalog.json': { fetchedAt: 'old', signedIn: true, items: [{ id: 1, title: 'Item 1', category: 'ships', vip: true, url: 'https://robertsspaceindustries.com/pledge/Standalone-Ships/Item-1', priceCents: 5000, thumbUrl: 'https://media.robertsspaceindustries.com/1/s.jpg', thumb: 'catalog/1.webp' }] } },
    catalogRequest([], { 72: [gqlItem(1, { isVip: true })] }));
  io.listCatalogImages = async () => ['catalog/1.webp'];
  await sync('store-catalog', io, {});
  assert.equal(io.files['store-catalog.json'].items[0].thumb, 'catalog/1.webp');
});

test('store-catalog: a much smaller answer or a failed listing keeps the saved file', async () => {
  const old = { fetchedAt: 'old', signedIn: true, items: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `T${i}`, category: 'ships', url: `https://robertsspaceindustries.com/pledge/Standalone-Ships/T${i}`, priceCents: 100, vip: i === 0 })) };
  const small = memory({ 'store-catalog.json': old }, catalogRequest([], { 72: [gqlItem(1, { isVip: true }), gqlItem(2)] }));
  await assert.rejects(sync('store-catalog', small, {}), /2 store items, the saved catalog has 20/);
  assert.deepEqual(small.files['store-catalog.json'], old);
  const failing = memory({ 'store-catalog.json': old }, async () => { throw new Error('RSI refused the request (403)'); });
  await assert.rejects(sync('store-catalog', failing, {}), /403/);
  assert.deepEqual(failing.files['store-catalog.json'], old);
});

test('store-catalog is cancellable between requests', async () => {
  let n = 0;
  const io = memory({}, async (a) => { n++; return catalogRequest([], {})(a); });
  await assert.rejects(sync('store-catalog', io, { cancelled: () => n >= 2 }), /cancelled/);
});

test('store-catalog: a session answered with the public view is saved as public, and a signed-in file is not replaced by it', async () => {
  const fresh = memory({}, catalogRequest([], { 72: [gqlItem(1), gqlItem(2)] }));
  await sync('store-catalog', fresh, {});
  assert.equal(fresh.files['store-catalog.json'].signedIn, false);
  assert.ok(fresh.logs.some((l) => /no Subscriber or Concierge items/.test(l)));
  const old = { fetchedAt: 'old', signedIn: true, items: [{ id: 1, title: 'Item 1', category: 'ships', vip: true, url: 'https://robertsspaceindustries.com/pledge/Standalone-Ships/Item-1', priceCents: 5000 }] };
  const kept = memory({ 'store-catalog.json': old }, catalogRequest([], { 72: [gqlItem(1)] }));
  await assert.rejects(sync('store-catalog', kept, {}), /signed-in sync/);
  assert.deepEqual(kept.files['store-catalog.json'], old);
});
