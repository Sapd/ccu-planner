import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDevStore, readImage, guardPost } from '../../app/vite-dev-data.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-dev-store-'));
const write = (dir, rel, text = '{}') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

test('save: stale rev is a conflict and writes nothing', () => {
  const dir = tmp();
  write(dir, 'plans.json', '{"rev":3}');
  const store = createDevStore(dir);
  assert.throws(() => store.save('plans', {}, 2), /^Error: conflict$/);
  assert.equal(fs.readFileSync(path.join(dir, 'plans.json'), 'utf8'), '{"rev":3}');
  assert.equal(store.save('plans', { a: 1 }, 3), 4);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'plans.json'), 'utf8')), { a: 1, rev: 4 });
});

test('save: rejects non-object documents, bad names and bad base revs', () => {
  const dir = tmp();
  const store = createDevStore(dir);
  for (const doc of [undefined, null, [], 'x', 5]) assert.throws(() => store.save('plans', doc, 0), /document must be an object/);
  for (const rev of [-1, 1.5, '0', undefined, null, NaN]) assert.throws(() => store.save('plans', {}, rev), /invalid base revision/);
  assert.throws(() => store.save('../catalog', {}, 0), /unknown document name/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('import: copies only allowlisted files and skips symlinks', () => {
  const src = tmp(); const dest = tmp();
  for (const f of ['catalog.json', 'hangar.json', 'session.json']) write(src, f);
  write(src, 'profile/private.json');
  write(src, 'upgrades/b.json'); write(src, 'upgrades/a.json'); write(src, 'upgrades/session.txt', 'x');
  write(src, 'secret.txt', 'secret');
  fs.symlinkSync(path.join(src, 'secret.txt'), path.join(src, 'buyback.json'));
  const r = createDevStore(dest).importLegacy(src);
  assert.deepEqual(r, { copied: ['hangar.json', 'upgrades/a.json', 'upgrades/b.json', 'catalog.json'], skipped: [] });
  assert.ok(!fs.existsSync(path.join(dest, 'session.json')));
  assert.ok(!fs.existsSync(path.join(dest, 'profile')));
  assert.ok(!fs.existsSync(path.join(dest, 'buyback.json')));
  assert.ok(!fs.existsSync(path.join(dest, 'upgrades/session.txt')));
});

test('import: refuses a symlinked catalog and a missing one', () => {
  const src = tmp(); const dest = tmp();
  write(src, 'real.json');
  fs.symlinkSync(path.join(src, 'real.json'), path.join(src, 'catalog.json'));
  assert.throws(() => createDevStore(dest).importLegacy(src), /catalog\.json is missing/);
  assert.throws(() => createDevStore(dest).importLegacy(tmp()), /catalog\.json is missing/);
});

test('import: refuses its own data dir and leaves files alone', () => {
  const dir = tmp();
  write(dir, 'catalog.json', 'original');
  const store = createDevStore(dir);
  assert.throws(() => store.importLegacy(dir), /source is the app data dir/);
  assert.throws(() => store.importLegacy(path.join(dir, 'x', '..')), /source is the app data dir/);
  assert.equal(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'), 'original');
});

test('import: keeps existing plans.json and price-overrides.json', () => {
  const src = tmp(); const dest = tmp();
  for (const f of ['catalog.json', 'plans.json', 'price-overrides.json']) write(src, f, 'legacy');
  write(dest, 'plans.json', 'mine'); write(dest, 'price-overrides.json', 'mine');
  const r = createDevStore(dest).importLegacy(src);
  assert.deepEqual(r, { copied: ['catalog.json'], skipped: ['plans.json', 'price-overrides.json'] });
  assert.equal(fs.readFileSync(path.join(dest, 'plans.json'), 'utf8'), 'mine');
});

test('load: upgrades are regular .json files read in name order, like the Rust store', async () => {
  const dir = tmp();
  write(dir, 'catalog.json', '{"ships":[]}');
  write(dir, 'upgrades/z.json', '{"id":"z"}'); write(dir, 'upgrades/a.json', '{"id":"a"}');
  write(dir, 'upgrades/note.txt', 'x'); fs.mkdirSync(path.join(dir, 'upgrades/sub.json'));
  const raw = createDevStore(dir).load();
  assert.deepEqual(raw.upgrades, [{ id: 'a' }, { id: 'z' }]);
  assert.equal(createDevStore(tmp()).load(), null);
});

test('import and load carry ship-images.json like the Rust store', () => {
  const src = tmp(); const dest = tmp();
  write(src, 'catalog.json', '{"ships":[]}');
  write(src, 'ship-images.json', '{"images":{}}');
  const store = createDevStore(dest);
  assert.deepEqual(store.importLegacy(src).copied, ['ship-images.json', 'catalog.json']);
  assert.deepEqual(store.load().images, { images: {} });
  fs.rmSync(path.join(dest, 'ship-images.json'));
  assert.equal(store.load().images, null);
});

test('import copies matching ship pictures, skips existing ones, odd names and symlinks', () => {
  const src = tmp(); const dest = tmp();
  write(src, 'catalog.json');
  write(src, 'images/1-s.webp', 'new-s'); write(src, 'images/1-l.webp', 'l');
  write(src, 'images/2-s.png'); write(src, 'images/x-s.webp'); write(src, 'images/1-m.webp'); write(src, 'images/sub-1-s.webp/a');
  write(src, 'secret.txt', 'secret');
  fs.symlinkSync(path.join(src, 'secret.txt'), path.join(src, 'images/3-s.webp'));
  write(dest, 'images/1-s.webp', 'old-s');
  const r = createDevStore(dest).importLegacy(src);
  assert.deepEqual(r.copied, ['images/1-l.webp', 'catalog.json']);
  assert.deepEqual(r.skipped, ['images/1-s.webp']);
  assert.equal(fs.readFileSync(path.join(dest, 'images/1-s.webp'), 'utf8'), 'old-s');
  assert.deepEqual(fs.readdirSync(path.join(dest, 'images')).sort(), ['1-l.webp', '1-s.webp']);
});

test('image endpoint: only <id>-s|l.webp regular files inside images/', () => {
  const dir = tmp();
  write(dir, 'images/12-s.webp', 'pic'); write(dir, 'images/12-l.webp', 'big');
  write(dir, 'images/1-s.png'); write(dir, 'secret.txt', 'x'); write(dir, 'catalog.json');
  assert.equal(readImage(dir, '12-s.webp').toString(), 'pic');
  for (const bad of ['../secret.txt', '../images/12-s.webp', '..%2Fx', '1-s.png', '12-s.webp/', '/12-s.webp', 'catalog.json', '1-s.webp\n', '99-s.webp', '', null, undefined]) assert.equal(readImage(dir, bad), null, String(bad));
});

test('image endpoint refuses a symlinked images folder', () => {
  const dir = tmp(); const other = tmp();
  write(other, '1-s.webp', 'pic');
  fs.symlinkSync(other, path.join(dir, 'images'));
  assert.equal(readImage(dir, '1-s.webp'), null);
});

test('sale-events: saved with the rev rule; sale-history and sale-events are imported, an existing sale-events is kept', () => {
  const dir = tmp();
  const store = createDevStore(dir);
  assert.equal(store.save('sale-events', { events: [] }, 0), 1);
  assert.throws(() => store.save('sale-events', { events: [] }, 0), /^Error: conflict$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sale-events.json'), 'utf8')), { events: [], rev: 1 });
  const src = tmp(); const dest = tmp();
  for (const f of ['catalog.json', 'sale-history.json', 'sale-events.json']) write(src, f);
  write(dest, 'sale-events.json', '{"rev":4,"events":[]}');
  const r = createDevStore(dest).importLegacy(src);
  assert.deepEqual(r, { copied: ['sale-history.json', 'catalog.json'], skipped: ['sale-events.json'] });
  assert.equal(fs.readFileSync(path.join(dest, 'sale-events.json'), 'utf8'), '{"rev":4,"events":[]}');
});

test('warbond-prices: imported like sale-history.json and loaded with the raw data', () => {
  const src = tmp(); const dest = tmp();
  write(src, 'catalog.json'); write(src, 'warbond-prices.json', '{"pairs":{"1-2":{"cash":3500,"at":"2026-11-18","skuId":20}}}');
  const store = createDevStore(dest);
  assert.deepEqual(store.importLegacy(src).copied, ['warbond-prices.json', 'catalog.json']);
  assert.deepEqual(store.load().warbondPrices, { pairs: { '1-2': { cash: 3500, at: '2026-11-18', skuId: 20 } } });
  fs.rmSync(path.join(dest, 'warbond-prices.json'));
  assert.deepEqual(store.load().warbondPrices, { pairs: {} });
});

test('plan-snapshots: imported and loaded like the Rust store, and the app cannot save it', () => {
  const src = tmp(); const dest = tmp();
  const doc = { version: 1, snapshots: [{ at: 'a', storeAt: 'S', hangarAt: 'H', total: 0, goals: {}, msrp: {} }] };
  write(src, 'catalog.json'); write(src, 'plan-snapshots.json', JSON.stringify(doc));
  const store = createDevStore(dest);
  assert.deepEqual(store.importLegacy(src).copied, ['plan-snapshots.json', 'catalog.json']);
  assert.deepEqual(store.load().planSnapshots, doc);
  // A re-import replaces it (it is synced data, not one of the documents you edit).
  write(src, 'plan-snapshots.json', '{"version":1,"snapshots":[]}');
  assert.deepEqual(store.importLegacy(src).copied, ['plan-snapshots.json', 'catalog.json']);
  assert.deepEqual(store.load().planSnapshots, { version: 1, snapshots: [] });
  assert.throws(() => store.save('plan-snapshots', { snapshots: [] }, 0), /unknown document name/);
  fs.rmSync(path.join(dest, 'plan-snapshots.json'));
  assert.equal(store.load().planSnapshots, null);
});

test('import: catalog.json is copied last, the import-complete marker', () => {
  const src = tmp(); const dest = tmp();
  write(src, 'catalog.json'); write(src, 'hangar.json'); write(src, 'upgrades/a.json'); write(src, 'images/1-s.webp');
  const r = createDevStore(dest).importLegacy(src);
  assert.equal(r.copied.at(-1), 'catalog.json');
});

test('import: a failing copy leaves no catalog.json', { skip: process.getuid?.() === 0 || process.platform === 'win32' /* chmod 000 does not block reads on Windows */ }, () => {
  const src = tmp(); const dest = tmp();
  write(src, 'catalog.json'); write(src, 'hangar.json');
  fs.chmodSync(path.join(src, 'hangar.json'), 0o000);
  try { assert.throws(() => createDevStore(dest).importLegacy(src)); } finally { fs.chmodSync(path.join(src, 'hangar.json'), 0o644); }
  assert.equal(fs.existsSync(path.join(dest, 'catalog.json')), false);
});

test('guardPost: JSON content type and same origin only', () => {
  const post = (headers) => guardPost({ method: 'POST', headers });
  const ok = { 'content-type': 'application/json', host: 'localhost:1420' };
  assert.equal(post(ok), null);
  assert.equal(post({ ...ok, 'content-type': 'application/json; charset=utf-8', origin: 'http://localhost:1420', 'sec-fetch-site': 'same-origin' }), null);
  assert.ok(post({ host: 'localhost:1420' }), 'no content type');
  assert.ok(post({ ...ok, 'content-type': 'text/plain' }));
  assert.ok(post({ ...ok, origin: 'https://evil.example' }));
  assert.ok(post({ ...ok, origin: 'null' }));
  assert.ok(post({ ...ok, 'sec-fetch-site': 'cross-site' }));
  assert.equal(guardPost({ method: 'GET', headers: {} }), null);
});

test('catalog: the dev store reads store-catalog.json, none is null, and it is never part of an import', () => {
  const dir = tmp();
  const store = createDevStore(dir);
  assert.equal(store.loadCatalog(), null);
  write(dir, 'store-catalog.json', '{"fetchedAt":"T","items":[]}');
  assert.deepEqual(store.loadCatalog(), { fetchedAt: 'T', items: [] });
  const src = tmp(); write(src, 'catalog.json'); write(src, 'store-catalog.json', '{"items":[]}'); write(src, 'images/catalog/1.webp', 'x');
  assert.deepEqual(createDevStore(tmp()).importLegacy(src).copied, ['catalog.json']);
});

test('image endpoint: catalog pictures are only images/catalog/<id>.<image format> regular files', () => {
  const dir = tmp();
  write(dir, 'images/catalog/12.webp', 'pic'); write(dir, 'images/catalog/a.webp'); write(dir, 'images/catalog/12.png', 'x'); write(dir, 'images/catalog/12.svg', 'x'); write(dir, 'secret.txt', 'x');
  assert.equal(readImage(dir, 'catalog/12.webp').toString(), 'pic');
  assert.equal(readImage(dir, 'catalog/12.png').toString(), 'x'); // the desktop app keeps the format RSI sent
  for (const bad of ['catalog/../secret.txt', 'catalog/a.webp', 'catalog/12.svg', 'catalog/12.png.x', 'catalog/12.webp/', 'catalog//12.webp', '../catalog/12.webp', 'catalog/12/x.webp', 'catalog/', 'catalog/99.webp']) assert.equal(readImage(dir, bad), null, bad);
  const other = tmp(); write(other, '5.webp', 'pic');
  const linked = tmp(); fs.mkdirSync(path.join(linked, 'images')); fs.symlinkSync(other, path.join(linked, 'images', 'catalog'));
  assert.equal(readImage(linked, 'catalog/5.webp'), null);
});

test('pending import: kept in its own file, read back, removed by null; a damaged file reads as none', () => {
  const dir = tmp();
  const store = createDevStore(dir);
  assert.equal(store.loadPending(), null);
  store.savePending({ version: 1, chains: [{ name: 'a' }] });
  assert.deepEqual(store.loadPending(), { version: 1, chains: [{ name: 'a' }] });
  assert.ok(!fs.existsSync(path.join(dir, 'plans.json')), 'it never touches the revisioned documents');
  fs.writeFileSync(path.join(dir, 'pending-import.json'), '{ broken');
  assert.equal(store.loadPending(), null);
  store.savePending({ version: 1, chains: [] });
  store.savePending(null);
  assert.equal(store.loadPending(), null);
  assert.ok(!fs.existsSync(path.join(dir, 'pending-import.json')));
  store.savePending(null); // removing nothing is fine
  for (const doc of [undefined, 'x', 5, []]) assert.throws(() => store.savePending(doc), /object or null/);
});

test('feed pictures are served from feed/images/catalog (feed/catalog/<id>.webp, webp only), without an images folder, and never through a symlink', () => {
  const dir = tmp();
  write(dir, 'feed/images/catalog/5.webp', 'feedpic');
  assert.equal(readImage(dir, 'feed/catalog/5.webp').toString(), 'feedpic');
  for (const bad of ['feed/catalog/5.png', 'feed/catalog/x.webp', 'feed/catalog/../manifest.json', 'feed/5.webp', 'feed/images/catalog/5.webp', 'feed/catalog/6.webp']) assert.equal(readImage(dir, bad), null, bad);
  const other = tmp();
  write(other, 'secret/catalog/5.webp', 'secret');
  const linked = tmp();
  fs.mkdirSync(path.join(linked, 'feed'));
  fs.symlinkSync(path.join(other, 'secret'), path.join(linked, 'feed', 'images'), 'dir');
  assert.equal(readImage(linked, 'feed/catalog/5.webp'), null);
});

test('feed ship pictures are served from feed/images/ships (feed/ships/<id>.webp, webp only) and never through a symlinked folder', () => {
  const dir = tmp();
  write(dir, 'feed/images/ships/7.webp', 'shippic');
  assert.equal(readImage(dir, 'feed/ships/7.webp').toString(), 'shippic');
  for (const bad of ['feed/ships/7.png', 'feed/ships/x.webp', 'feed/ships/../manifest.json', 'feed/ships/8.webp', 'feed/ships//7.webp', 'feed/ships/7/8.webp', 'ships/7.webp', 'feed/other/7.webp']) assert.equal(readImage(dir, bad), null, bad);
  const other = tmp();
  write(other, 'secret/7.webp', 'secret');
  const linked = tmp();
  fs.mkdirSync(path.join(linked, 'feed', 'images'), { recursive: true });
  fs.symlinkSync(path.join(other, 'secret'), path.join(linked, 'feed', 'images', 'ships'), 'dir');
  assert.equal(readImage(linked, 'feed/ships/7.webp'), null);
});
