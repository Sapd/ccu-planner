import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FEED_PUBLIC_KEY, FEED_MIN_GENERATED_AT, publicKeyFrom, verifyManifest, signManifest, sha256, refreshFeed, fetchFeedImages, readFeed, loadFeedEvents, feedBase } from '../src/feed.mjs';
import { buildFeed } from '../src/feed-build.mjs';
import { sanitizeFeedCache, catalogCacheOk } from '../src/feed-cache.mjs';
import { validateManifest, isWebp, feedIsStale } from '../src/logic/feed.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-feed-'));
const pair = (seed) => {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, seed)]), format: 'der', type: 'pkcs8' });
  return { priv, pub: crypto.createPublicKey(priv) };
};
const KEY = pair(1);
const OTHER = pair(2);
/** The smallest thing isWebp accepts: a RIFF container of the right length with the WEBP form type (not decodable, which the container check does not need). */
const webp = (text = '') => {
  const body = Buffer.concat([Buffer.from('WEBPVP8L'), Buffer.from(text.padEnd(8, '.'))]);
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF'), size, body]);
};
const json = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);

/** A feed as a map of path -> bytes (what a server would hold), built the way buildFeed does it. */
function site({ at = '2026-11-20T10:00:00.000Z', events = [{ id: 'iae', name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }], pics = { 5: 'pic5' }, key = KEY } = {}) {
  const files = new Map();
  files.set('events.json', json({ schema: 1, events }));
  const items = Object.keys(pics).map((id) => ({ id: Number(id), title: `Ship ${id}`, category: 'ships', url: `https://robertsspaceindustries.com/pledge/ships/x/${id}`, priceCents: 1000, thumb: `catalog/${id}.webp`, thumbUrl: null }));
  files.set('store-catalog.json', json({ fetchedAt: at, signedIn: false, items }));
  for (const [id, body] of Object.entries(pics)) files.set(`images/catalog/${id}.webp`, Buffer.from(body));
  const manifest = { schema: 1, generatedAt: at, files: Object.fromEntries([...files].sort().map(([n, b]) => [n, { sha256: sha256(b), size: b.length }])) };
  const bytes = json(manifest);
  files.set('manifest.json', bytes);
  files.set('manifest.json.sig', Buffer.from(`${signManifest(bytes, key.priv)}\n`));
  return files;
}
/** A fetch over such a map; `log` collects the paths asked for. */
const serve = (files, log = []) => async (url, init) => {
  assert.equal(init.redirect, 'error');
  assert.ok(!init.headers?.cookie && !init.headers?.authorization && !init.body, 'a plain GET with nothing in it');
  const p = new URL(url).pathname.replace(/^\/feed\//, '');
  log.push(p);
  const body = files.get(p);
  if (!body) return new Response('no', { status: 404 });
  return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
};
const BASE = 'https://feed.test/feed/';
// A fixed floor, so the tests do not depend on src/feed-floor.json, which `npm run version` moves on every release.
const TEST_FLOOR = '2026-01-01T00:00:00Z';
const opts = (dir, files, extra = {}) => ({ dir, fetch: serve(files, extra.log), base: BASE, publicKey: KEY.pub, minGeneratedAt: TEST_FLOOR, ...extra });

test('the embedded public key is 32 raw ed25519 bytes and a key of the app can be rebuilt from base64', () => {
  assert.equal(FEED_PUBLIC_KEY.asymmetricKeyType, 'ed25519');
  assert.equal(publicKeyFrom(KEY.pub.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')).export({ type: 'spki', format: 'der' }).equals(KEY.pub.export({ type: 'spki', format: 'der' })), true);
  assert.throws(() => publicKeyFrom('AAAA'), /32 bytes/);
});

test('manifest verification: good, tampered manifest, wrong key, bad signature', () => {
  const files = site();
  const bytes = files.get('manifest.json');
  const sig = files.get('manifest.json.sig').toString();
  const m = verifyManifest(bytes, sig, KEY.pub);
  assert.equal(m.generatedAt, '2026-11-20T10:00:00.000Z');
  assert.ok(m.files['events.json'].sha256);
  const tampered = Buffer.from(bytes.toString().replace('2026-11-20', '2026-11-21'));
  assert.throws(() => verifyManifest(tampered, sig, KEY.pub), /signature does not match/);
  assert.throws(() => verifyManifest(bytes, sig, OTHER.pub), /signature does not match/);
  assert.throws(() => verifyManifest(bytes, 'AAAA', KEY.pub), /wrong length/);
  assert.throws(() => verifyManifest(bytes, sig.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')), KEY.pub), /does not match|wrong length/);
});

test('a signed manifest must still be well formed: schema, allowlisted names, hashes and sizes', () => {
  const ok = { schema: 1, generatedAt: '2026-11-20T10:00:00Z', files: { 'events.json': { sha256: 'a'.repeat(64), size: 1 } } };
  assert.ok(validateManifest(ok));
  for (const bad of [
    { ...ok, schema: 2 }, { ...ok, generatedAt: 'soon' }, { ...ok, files: { '../x.json': ok.files['events.json'] } },
    { ...ok, files: { 'images/catalog/x.webp': ok.files['events.json'] } }, { ...ok, files: { 'events.json': { sha256: 'xyz', size: 1 } } },
    { ...ok, files: { 'events.json': { sha256: 'a'.repeat(64), size: -1 } } }, { ...ok, files: [] }, null,
  ]) assert.throws(() => validateManifest(bad));
  const signed = Buffer.from(JSON.stringify({ ...ok, files: { 'sync.lock': ok.files['events.json'] } }));
  assert.throws(() => verifyManifest(signed, signManifest(signed, KEY.priv), KEY.pub), /not allowed/);
});

test('Rust and Node agree: the fixture signed with a throwaway key verifies here and re-signs to the same bytes', () => {
  const d = new URL('../app/src-tauri/tests/fixtures/feed/', import.meta.url);
  const read = (f) => fs.readFileSync(new URL(f, d));
  const pub = publicKeyFrom(read('public-key.txt').toString().trim());
  const m = verifyManifest(read('manifest.json'), read('manifest.json.sig').toString(), pub);
  assert.equal(m.files['events.json'].sha256, sha256(read('events.json')));
  const seeded = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 0x42)]), format: 'der', type: 'pkcs8' });
  assert.equal(`${signManifest(read('manifest.json'), seeded)}\n`, read('manifest.json.sig').toString()); // ed25519 is deterministic
  assert.throws(() => verifyManifest(read('manifest.json'), read('manifest.json.sig').toString()), /does not match/); // not the real key
});

test('a refresh verifies the manifest, saves the files and reads back; the second one inside 6 hours asks nothing', async () => {
  const dir = tmp();
  const files = site();
  const log = [];
  const r = await refreshFeed({ ...opts(dir, files, { log }), now: () => 1000 });
  assert.deepEqual([r.status, r.generatedAt], ['updated', '2026-11-20T10:00:00.000Z']);
  assert.deepEqual(log, ['manifest.json', 'manifest.json.sig', 'events.json', 'store-catalog.json']);
  const feed = readFeed(dir, { publicKey: KEY.pub });
  assert.equal(feed.eventsDoc.events[0].name, 'IAE 2956');
  assert.equal(feed.catalog.items.length, 1);
  assert.deepEqual(feed.images, []); // pictures come separately
  log.length = 0;
  assert.equal((await refreshFeed({ ...opts(dir, files, { log }), now: () => 1000 + 6 * 3600e3 - 1 })).status, 'skipped');
  assert.deepEqual(log, []);
  const again = await refreshFeed({ ...opts(dir, files, { log }), now: () => 1000 + 6 * 3600e3 });
  assert.equal(again.status, 'unchanged');
  assert.deepEqual(log, ['manifest.json', 'manifest.json.sig'], 'files the manifest says are unchanged are not downloaded again');
  assert.equal((await refreshFeed({ ...opts(dir, files, { log }), force: true, now: () => 1001 })).status, 'unchanged');
  // After an app update the first start checks at once, though the last check was a minute ago.
  log.length = 0;
  assert.equal((await refreshFeed({ ...opts(dir, files, { log }), now: () => 1002 })).status, 'skipped');
  assert.equal((await refreshFeed({ ...opts(dir, files, { log }), now: () => 1003, appVersion: '99.0.0' })).status, 'unchanged');
  assert.deepEqual(log, ['manifest.json', 'manifest.json.sig']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'feed', 'state.json'), 'utf8')).app, '99.0.0');
});

test('a tampered manifest or the wrong key is rejected and the last good copy stays', async () => {
  const dir = tmp();
  await refreshFeed({ ...opts(dir, site()), now: () => 1 });
  const before = fs.readFileSync(path.join(dir, 'feed', 'manifest.json'));
  const evil = site({ at: '2026-11-21T10:00:00.000Z', events: [{ id: 'x', name: 'Evil sale', from: '2026-11-21', to: '2026-12-31' }] });
  evil.set('manifest.json', Buffer.from(evil.get('manifest.json').toString().replace('2026-11-21T10', '2026-11-21T11')));
  const r1 = await refreshFeed({ ...opts(dir, evil), force: true });
  assert.equal(r1.status, 'rejected');
  assert.match(r1.error, /signature/);
  const r2 = await refreshFeed({ ...opts(dir, site({ key: OTHER, at: '2026-11-22T10:00:00.000Z' })), force: true });
  assert.equal(r2.status, 'rejected');
  assert.ok(fs.readFileSync(path.join(dir, 'feed', 'manifest.json')).equals(before));
  assert.equal(loadFeedEventsAt(dir)[0].name, 'IAE 2956');
});
const loadFeedEventsAt = (dir) => (readFeed(dir, { publicKey: KEY.pub })?.eventsDoc?.events ?? []);

test('a file that does not match its signed hash is rejected, nothing of that refresh is kept', async () => {
  const dir = tmp();
  await refreshFeed({ ...opts(dir, site()), now: () => 1 });
  const next = site({ at: '2026-11-21T10:00:00.000Z', events: [{ id: 'b', name: 'Next sale', from: '2026-12-01', to: '2026-12-05' }] });
  next.set('events.json', json({ schema: 1, events: [{ id: 'b', name: 'Tampered', from: '2026-12-01', to: '2026-12-05' }] })); // the manifest still has the hash of the real one
  const r = await refreshFeed({ ...opts(dir, next), force: true });
  assert.equal(r.status, 'rejected');
  assert.match(r.error, /events\.json does not match/);
  assert.equal(readFeed(dir, { publicKey: KEY.pub }).generatedAt, '2026-11-20T10:00:00.000Z');
  assert.equal(loadFeedEventsAt(dir)[0].name, 'IAE 2956');
});

test('when one file is refused, the other new file is not saved either: the old copy stays whole', async () => {
  const dir = tmp();
  await refreshFeed({ ...opts(dir, site()), now: () => 1 });
  const next = site({ at: '2026-11-21T10:00:00.000Z', events: [{ id: 'b', name: 'Next sale', from: '2026-12-01', to: '2026-12-05' }] });
  next.set('store-catalog.json', json({ fetchedAt: 'tampered', items: [] }));
  const r = await refreshFeed({ ...opts(dir, next), force: true });
  assert.equal(r.status, 'rejected');
  assert.equal(loadFeedEventsAt(dir)[0].name, 'IAE 2956');
  assert.equal(readFeed(dir, { publicKey: KEY.pub }).catalog.items.length, 1);
});

test('an older signed manifest does not roll the saved copy back', async () => {
  const dir = tmp();
  await refreshFeed({ ...opts(dir, site({ at: '2026-11-20T10:00:00.000Z' })), now: () => 1 });
  const r = await refreshFeed({ ...opts(dir, site({ at: '2026-11-19T10:00:00.000Z', events: [] })), force: true });
  assert.equal(r.status, 'rejected');
  assert.match(r.error, /older/);
  assert.equal(readFeed(dir, { publicKey: KEY.pub }).generatedAt, '2026-11-20T10:00:00.000Z');
});

test('offline is silent: a network error or a server error changes nothing, and a missing feed is not an error either', async () => {
  const dir = tmp();
  const down = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  assert.equal((await refreshFeed({ dir, fetch: down, base: BASE, publicKey: KEY.pub })).status, 'offline');
  const five = async () => new Response('x', { status: 503 });
  assert.equal((await refreshFeed({ dir, fetch: five, base: BASE, publicKey: KEY.pub })).status, 'offline');
  assert.equal(readFeed(dir, { publicKey: KEY.pub }), null);
  assert.deepEqual(loadFeedEvents(dir), { events: [], at: null });
  assert.equal(fs.existsSync(path.join(dir, 'feed', 'manifest.json')), false);
  // After a good copy, going offline keeps it and the next start retries (a failed check is not recorded).
  await refreshFeed({ ...opts(dir, site()), now: () => 1 });
  assert.equal((await refreshFeed({ dir, fetch: down, base: BASE, publicKey: KEY.pub, force: true })).status, 'offline');
  assert.equal(loadFeedEventsAt(dir).length, 1);
});

test('a redirect is not followed and a body over the cap is refused', async () => {
  const dir = tmp();
  const redirect = async (url, init) => { assert.equal(init.redirect, 'error'); throw new TypeError('redirect mode is set to error'); };
  assert.equal((await refreshFeed({ dir, fetch: redirect, base: BASE, publicKey: KEY.pub })).status, 'offline');
  const huge = async () => new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } });
  assert.equal((await refreshFeed({ dir, fetch: huge, base: BASE, publicKey: KEY.pub })).status, 'rejected');
});

test('a damaged cache reads as no feed: edited manifest, edited events file, a signature of another key', async () => {
  const dir = tmp();
  await refreshFeed({ ...opts(dir, site()), now: () => 1 });
  const events = path.join(dir, 'feed', 'events.json');
  fs.writeFileSync(events, '{"schema":1,"events":[]}');
  assert.equal(readFeed(dir, { publicKey: KEY.pub }).eventsDoc, null);
  assert.equal(readFeed(dir, { publicKey: OTHER.pub }), null);
  fs.appendFileSync(path.join(dir, 'feed', 'manifest.json'), ' ');
  assert.equal(readFeed(dir, { publicKey: KEY.pub }), null);
});

test('pictures: downloaded in batches, each checked against its hash, unlisted ones removed at the end', async () => {
  const dir = tmp();
  const files = site({ pics: { 5: 'pic5', 6: 'pic6', 7: 'pic7' } });
  await refreshFeed({ ...opts(dir, files), now: () => 1 });
  const log = [];
  const first = await fetchFeedImages({ ...opts(dir, files, { log }), limit: 2 });
  assert.deepEqual(first, { downloaded: 2, remaining: 1, failed: 0 });
  assert.equal(readFeed(dir, { publicKey: KEY.pub }).images.length, 2);
  fs.writeFileSync(path.join(dir, 'feed', 'images', 'catalog', '99.webp'), 'old');
  const second = await fetchFeedImages({ ...opts(dir, files, { log }), limit: 2 });
  assert.deepEqual(second, { downloaded: 1, remaining: 0, failed: 0 });
  assert.deepEqual(readFeed(dir, { publicKey: KEY.pub }).images, ['catalog/5.webp', 'catalog/6.webp', 'catalog/7.webp']);
  assert.equal(fs.existsSync(path.join(dir, 'feed', 'images', 'catalog', '99.webp')), false);
  // A picture whose bytes do not match the manifest is never saved.
  const bad = new Map(files); bad.set('images/catalog/6.webp', Buffer.from('evil'));
  fs.rmSync(path.join(dir, 'feed', 'images', 'catalog', '6.webp'));
  const r = await fetchFeedImages({ ...opts(dir, bad), limit: 10 });
  assert.deepEqual([r.downloaded, r.remaining, r.failed], [0, 1, 1]);
  assert.equal(fs.existsSync(path.join(dir, 'feed', 'images', 'catalog', '6.webp')), false);
});

test('the feed address is the official one; CCU_FEED_URL counts only in the dev server, with --dev or under NODE_ENV=test, and only for localhost', () => {
  const OFFICIAL = 'https://sapd.github.io/ccu-planner/feed/';
  const url = { CCU_FEED_URL: 'http://localhost:9/feed' };
  assert.equal(feedBase({}), OFFICIAL);
  assert.equal(feedBase(url), OFFICIAL, 'a normal run (CLI, MCP) ignores it');
  assert.equal(feedBase({ ...url, NODE_ENV: 'production' }), OFFICIAL);
  assert.equal(feedBase(url, { dev: true }), 'http://localhost:9/feed/');
  assert.equal(feedBase({ ...url, NODE_ENV: 'test' }), 'http://localhost:9/feed/');
  assert.equal(feedBase({ CCU_FEED_URL: 'http://127.0.0.1:5/f/' }, { dev: true }), 'http://127.0.0.1:5/f/');
  for (const bad of ['https://evil.test/feed/', 'http://evil.test/feed/', 'http://user:pw@localhost/f/', 'http://localhost/f/?x=1', 'ftp://localhost/', 'nonsense'])
    assert.throws(() => feedBase({ CCU_FEED_URL: bad }, { dev: true }), /CCU_FEED_URL/, bad);
  assert.equal(feedBase({ CCU_FEED_URL: OFFICIAL }, { dev: true }), OFFICIAL);
});

// ----- the build -----

function catalogFixture(dir) {
  fs.mkdirSync(path.join(dir, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'catalog', '1.webp'), webp('one'));
  const item = (id, extra = {}) => ({ id, title: `Item ${id}`, category: 'ships', url: `https://robertsspaceindustries.com/pledge/ships/a/${id}`, priceCents: 100, thumb: `catalog/${id}.webp`, thumbUrl: 'https://media.robertsspaceindustries.com/x', ...extra });
  return { fetchedAt: '2026-11-20T09:00:00.000Z', signedIn: false, items: [item(1), item(2)] };
}

test('buildFeed writes events, catalog and only the pictures that exist, with a manifest that matches the bytes and verifies', () => {
  const out = path.join(tmp(), 'site');
  const images = tmp();
  const r = buildFeed({ outDir: out, privateKey: KEY.priv, publicKey: KEY.pub, events: JSON.parse(fs.readFileSync(new URL('../feed-src/events.json', import.meta.url))), catalog: catalogFixture(images), imagesDir: images, generatedAt: '2026-11-20T12:00:00.000Z' });
  assert.deepEqual([r.items, r.images], [2, 1]);
  const manifestBytes = fs.readFileSync(path.join(out, 'feed', 'manifest.json'));
  const m = verifyManifest(manifestBytes, fs.readFileSync(path.join(out, 'feed', 'manifest.json.sig'), 'utf8'), KEY.pub);
  assert.deepEqual(Object.keys(m.files), ['events.json', 'images/catalog/1.webp', 'store-catalog.json']);
  for (const [name, f] of Object.entries(m.files)) {
    const b = fs.readFileSync(path.join(out, 'feed', name));
    assert.deepEqual([f.size, f.sha256], [b.length, sha256(b)], name);
  }
  const cat = JSON.parse(fs.readFileSync(path.join(out, 'feed', 'store-catalog.json')));
  assert.deepEqual(cat.items.map((i) => i.thumb), ['catalog/1.webp', null], 'an item without a picture in the feed has no thumb');
  assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /not a website/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'feed', 'events.json'))).events[0].name, 'IAE 2956');
});

test('buildFeed refuses a signed-in catalog, bad events and a key that is not the embedded one', () => {
  const images = tmp();
  const base = { outDir: path.join(tmp(), 'o'), privateKey: KEY.priv, publicKey: KEY.pub, events: { events: [] }, imagesDir: images };
  assert.throws(() => buildFeed({ ...base, catalog: { ...catalogFixture(images), signedIn: true } }), /signed-in catalog/);
  for (const events of [{ events: [{ name: '', from: '2026-11-01', to: '2026-11-02' }] }, { events: [{ name: 'A', from: '2026-11-03', to: '2026-11-02' }] }, { events: [{ name: 'A', from: '2026-13-01', to: '2026-13-02' }] }, {}])
    assert.throws(() => buildFeed({ ...base, events }), /event|events/);
  assert.throws(() => buildFeed({ ...base, publicKey: undefined }), /does not match the public key/); // KEY is not the real feed key
  assert.equal(buildFeed({ ...base, catalog: null }).items, 0, 'a feed without a catalog is fine: clients keep theirs');
});

test('buildFeed signs a picture only when it is a WebP container named for its own item', () => {
  const images = tmp();
  const doc = catalogFixture(images);
  fs.writeFileSync(path.join(images, 'catalog', '2.webp'), Buffer.from('<script>alert(1)</script>'));
  const base = { outDir: path.join(tmp(), 'o'), privateKey: KEY.priv, publicKey: KEY.pub, events: { events: [] }, imagesDir: images };
  const r = buildFeed({ ...base, catalog: doc });
  assert.deepEqual([r.items, r.images, r.rejectedImages], [2, 1, ['catalog/2.webp']]);
  const cat = JSON.parse(fs.readFileSync(path.join(base.outDir, 'feed', 'store-catalog.json')));
  assert.deepEqual(cat.items.map((i) => i.thumb), ['catalog/1.webp', null]);
  // A thumb that names another item's picture (item 2 pointing at 1.webp) is dropped by the catalog reader before it can be signed.
  const crossed = { ...doc, items: doc.items.map((i) => (i.id === 2 ? { ...i, thumb: 'catalog/1.webp' } : i)) };
  const r2 = buildFeed({ ...base, catalog: crossed });
  assert.equal(r2.images, 1);
  assert.equal(r2.items, 1);
});

test('isWebp wants the RIFF header, the WEBP type, the exact length and an allowed size', () => {
  assert.equal(isWebp(webp('x')), true);
  assert.equal(isWebp(Buffer.from('one')), false);
  assert.equal(isWebp(null), false);
  const wrongType = webp('x'); wrongType.write('AVIF', 8);
  assert.equal(isWebp(wrongType), false);
  assert.equal(isWebp(Buffer.concat([webp('x'), Buffer.from('trailing')])), false, 'the RIFF size must be the whole file');
  assert.equal(isWebp(Buffer.concat([webp('x'), Buffer.alloc(4 * 1024 * 1024)])), false);
});

test('a manifest may not announce more than the total cap, whatever each file weighs', () => {
  const files = {};
  for (let i = 0; i < 40; i++) files[`images/catalog/${i}.webp`] = { sha256: 'a'.repeat(64), size: 4 * 1024 * 1024 };
  assert.ok(validateManifest({ schema: 1, generatedAt: '2026-11-20T10:00:00Z', files })); // 160 MiB
  for (let i = 40; i < 140; i++) files[`images/catalog/${i}.webp`] = { sha256: 'a'.repeat(64), size: 4 * 1024 * 1024 };
  assert.throws(() => validateManifest({ schema: 1, generatedAt: '2026-11-20T10:00:00Z', files }), /more data than allowed/); // 560 MiB
});

// ----- replay and freshness -----

test('the floor of this build and the highest feed ever accepted survive a wiped cache: an old signed manifest is refused on a fresh start', async () => {
  const dir = tmp();
  await refreshFeed({ ...opts(dir, site({ at: '2026-11-20T10:00:00.000Z' })), now: () => 1 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'feed-seen.json'), 'utf8')).highestGeneratedAt, '2026-11-20T10:00:00.000Z');
  const old = site({ at: '2026-11-19T10:00:00.000Z', events: [] });
  // The cache is wiped (or its manifest is damaged): the seen file still stands.
  fs.rmSync(path.join(dir, 'feed'), { recursive: true });
  const r = await refreshFeed({ ...opts(dir, old), force: true });
  assert.equal(r.status, 'rejected');
  assert.match(r.error, /older/);
  assert.equal(readFeed(dir, { publicKey: KEY.pub }), null);
  // A newer one is accepted and moves the mark up.
  assert.equal((await refreshFeed({ ...opts(dir, site({ at: '2026-11-21T10:00:00.000Z' })), force: true })).status, 'updated');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'feed-seen.json'), 'utf8')).highestGeneratedAt, '2026-11-21T10:00:00.000Z');
});

test('a brand new install refuses a manifest older than the floor built into the app', async () => {
  const dir = tmp();
  const r = await refreshFeed({ ...opts(dir, site({ at: '2026-01-01T00:00:00.000Z' })), now: () => 1, minGeneratedAt: FEED_MIN_GENERATED_AT });
  assert.equal(r.status, 'rejected');
  assert.ok(Date.parse('2026-01-01T00:00:00.000Z') < Date.parse(FEED_MIN_GENERATED_AT));
  assert.equal(fs.existsSync(path.join(dir, 'feed', 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'feed-seen.json')), false, 'a refused feed leaves no mark');
  const ok = await refreshFeed({ ...opts(dir, site({ at: '2026-01-01T00:00:00.000Z' })), now: () => 1, minGeneratedAt: '2025-12-31T00:00:00Z' });
  assert.equal(ok.status, 'updated');
});

test('the same date with other content is not an update', async () => {
  const dir = tmp();
  await refreshFeed({ ...opts(dir, site({ at: '2026-11-20T10:00:00.000Z' })), now: () => 1 });
  const other = site({ at: '2026-11-20T10:00:00.000Z', events: [{ id: 'b', name: 'Other', from: '2026-12-01', to: '2026-12-02' }] });
  const r = await refreshFeed({ ...opts(dir, other), force: true });
  assert.equal(r.status, 'rejected');
  assert.match(r.error, /same date/);
  assert.equal(loadFeedEventsAt(dir)[0].name, 'IAE 2956');
});

test('a feed older than 30 days is flagged stale, and its data is still used', async () => {
  const dir = tmp();
  const at = '2026-11-20T10:00:00.000Z';
  const day = 24 * 3600e3;
  assert.equal(feedIsStale(at, Date.parse(at) + 30 * day), false);
  assert.equal(feedIsStale(at, Date.parse(at) + 30 * day + 1), true);
  assert.equal(feedIsStale('garbage'), false);
  const fresh = await refreshFeed({ ...opts(dir, site({ at })), now: () => 1, clock: () => Date.parse(at) + 2 * day });
  assert.deepEqual([fresh.status, fresh.stale], ['updated', false]);
  const late = await refreshFeed({ ...opts(dir, site({ at })), force: true, clock: () => Date.parse(at) + 31 * day });
  assert.deepEqual([late.status, late.stale], ['unchanged', true]);
  assert.equal(loadFeedEventsAt(dir)[0].name, 'IAE 2956', 'the last good copy stays in use');
  const offline = await refreshFeed({ dir, fetch: async () => { throw new TypeError('x'); }, base: BASE, publicKey: KEY.pub, force: true, clock: () => Date.parse(at) + 31 * day });
  assert.deepEqual([offline.status, offline.stale], ['offline', true]);
});

// ----- the build's cache is untrusted -----

test('the restored cache is checked: only decodable WebP pictures with an allowed size and a catalog whose thumbs match their item survive', async () => {
  const { default: sharp } = await import('sharp');
  const cache = tmp();
  const folder = path.join(cache, 'images', 'catalog');
  fs.mkdirSync(folder, { recursive: true });
  const good = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#123456' } }).webp().toBuffer();
  const huge = await sharp({ create: { width: 600, height: 10, channels: 3, background: '#000' } }).webp().toBuffer();
  fs.writeFileSync(path.join(folder, '1.webp'), good);
  fs.writeFileSync(path.join(folder, '2.webp'), Buffer.from('<html>not a picture</html>'));
  fs.writeFileSync(path.join(folder, '3.webp'), await sharp({ create: { width: 8, height: 6, channels: 3, background: '#fff' } }).png().toBuffer());
  fs.writeFileSync(path.join(folder, '4.webp'), huge);
  fs.writeFileSync(path.join(folder, 'evil.html'), 'x');
  fs.writeFileSync(path.join(folder, '5.webp'), webp('looks right but cannot be decoded'));
  const item = (id, thumb) => ({ id, title: `Item ${id}`, category: 'ships', url: `https://robertsspaceindustries.com/pledge/ships/a/${id}`, priceCents: 100, thumb, thumbUrl: null });
  const doc = { fetchedAt: '2026-11-20T09:00:00.000Z', signedIn: false, items: [item(1, 'catalog/1.webp'), item(2, null)] };
  fs.writeFileSync(path.join(cache, 'store-catalog.json'), JSON.stringify(doc));
  const r = await sanitizeFeedCache({ cacheDir: cache, sharp });
  assert.deepEqual(r.removed.map((n) => path.basename(n)).sort(), ['2.webp', '3.webp', '4.webp', '5.webp', 'evil.html']);
  assert.deepEqual(fs.readdirSync(folder), ['1.webp']);
  assert.equal(r.catalog.items.length, 2);
  assert.equal(r.changed, true);
  // A second pass finds nothing to do.
  assert.equal((await sanitizeFeedCache({ cacheDir: cache, sharp })).changed, false);
});

test('a cached catalog that is signed in, has a crossed or foreign thumb name or a damaged item is thrown away whole', async () => {
  const { default: sharp } = await import('sharp');
  const item = (id, thumb) => ({ id, title: `Item ${id}`, category: 'ships', url: `https://robertsspaceindustries.com/pledge/ships/a/${id}`, priceCents: 100, thumb, thumbUrl: null });
  const ok = { fetchedAt: 'x', signedIn: false, items: [item(1, 'catalog/1.webp'), item(2, null)] };
  assert.equal(catalogCacheOk(ok), true);
  for (const bad of [
    { ...ok, signedIn: true },
    { ...ok, items: [item(1, 'catalog/2.webp')] },
    { ...ok, items: [item(1, '../../etc/passwd')] },
    { ...ok, items: [item(1, 'catalog/1.png')] },
    { ...ok, items: [item(1, null), { id: 'x' }] },
    { ...ok, items: [{ ...item(1, null), url: 'https://evil.test/x' }] },
    { items: 'no' }, null,
  ]) assert.equal(catalogCacheOk(bad), false, JSON.stringify(bad));
  const cache = tmp();
  fs.writeFileSync(path.join(cache, 'store-catalog.json'), JSON.stringify({ ...ok, signedIn: true }));
  const r = await sanitizeFeedCache({ cacheDir: cache, sharp });
  assert.equal(r.catalog, null);
  assert.equal(fs.existsSync(path.join(cache, 'store-catalog.json')), false);
});

// ----- ship pictures -----

test('buildFeed signs ship pictures only for the named ids and only when they are WebP containers', () => {
  const images = tmp();
  fs.mkdirSync(path.join(images, 'ships'), { recursive: true });
  fs.writeFileSync(path.join(images, 'ships', '7.webp'), webp('ship seven'));
  fs.writeFileSync(path.join(images, 'ships', '8.webp'), Buffer.from('<script>alert(1)</script>'));
  fs.writeFileSync(path.join(images, 'ships', '9.webp'), webp('not asked for'));
  const base = { outDir: path.join(tmp(), 'o'), privateKey: KEY.priv, publicKey: KEY.pub, events: { events: [] }, imagesDir: images };
  const r = buildFeed({ ...base, shipIds: [7, 8, 10, 7, -1, 1.5, '9'] });
  assert.equal(r.ships, 1);
  assert.deepEqual(r.rejectedImages, ['ships/8.webp']);
  const m = verifyManifest(fs.readFileSync(path.join(base.outDir, 'feed', 'manifest.json')), fs.readFileSync(path.join(base.outDir, 'feed', 'manifest.json.sig'), 'utf8'), KEY.pub);
  assert.deepEqual(Object.keys(m.files), ['events.json', 'images/ships/7.webp']);
  assert.equal(buildFeed({ ...base }).ships, 0, 'no ships named, no ship pictures');
});

test('a manifest may list ship pictures and only digit names under images/ships/', () => {
  const f = (name) => ({ schema: 1, generatedAt: '2026-11-20T10:00:00Z', files: { [name]: { sha256: 'a'.repeat(64), size: 1 } } });
  assert.ok(validateManifest(f('images/ships/12.webp')));
  for (const bad of ['images/ships/../12.webp', 'images/ships/a.webp', 'images/ships/12.png', 'images/ships/.webp', 'images/ships/1/2.webp', 'images/boats/1.webp', 'images/ships/12.webp/', '/images/ships/1.webp'])
    assert.throws(() => validateManifest(f(bad)), /not allowed/, bad);
});

test('ship pictures are downloaded before catalog pictures, scope "ships" leaves the catalog alone, and every picture is hash-checked', async () => {
  const dir = tmp();
  const files = site({ pics: { 5: 'pic5', 6: 'pic6' } });
  // Add two ship pictures to the served feed and re-sign it.
  const withShips = new Map(files);
  withShips.set('images/ships/7.webp', Buffer.from('ship7'));
  withShips.set('images/ships/20.webp', Buffer.from('ship20'));
  const manifest = JSON.parse(files.get('manifest.json'));
  for (const n of ['images/ships/7.webp', 'images/ships/20.webp']) manifest.files[n] = { sha256: sha256(withShips.get(n)), size: withShips.get(n).length };
  manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1)));
  const bytes = json(manifest);
  withShips.set('manifest.json', bytes);
  withShips.set('manifest.json.sig', Buffer.from(`${signManifest(bytes, KEY.priv)}\n`));
  await refreshFeed({ ...opts(dir, withShips), now: () => 1 });
  const log = [];
  const onlyShips = await fetchFeedImages({ ...opts(dir, withShips, { log }), scope: 'ships', concurrency: 1 });
  assert.deepEqual(onlyShips, { downloaded: 2, remaining: 0, failed: 0 });
  assert.deepEqual(log.filter((p) => p.startsWith('images/')), ['images/ships/20.webp', 'images/ships/7.webp'].sort((a, b) => (a < b ? -1 : 1)));
  assert.deepEqual(readFeed(dir, { publicKey: KEY.pub }).images.sort(), ['ships/20.webp', 'ships/7.webp']);
  log.length = 0;
  const rest = await fetchFeedImages({ ...opts(dir, withShips, { log }), limit: 10 });
  assert.deepEqual(rest, { downloaded: 2, remaining: 0, failed: 0 });
  assert.deepEqual(log, ['images/catalog/5.webp', 'images/catalog/6.webp']);
  // Ship pictures come first when everything is missing.
  const dir2 = tmp();
  await refreshFeed({ ...opts(dir2, withShips), now: () => 1 });
  const order = [];
  await fetchFeedImages({ ...opts(dir2, withShips, { log: order }), concurrency: 1 });
  assert.deepEqual(order.map((p) => p.split('/')[1]), ['ships', 'ships', 'catalog', 'catalog']);
  // A ship picture whose bytes differ from the signed hash is never saved; one the manifest dropped is removed at the end.
  fs.rmSync(path.join(dir2, 'feed', 'images', 'ships', '7.webp'));
  fs.writeFileSync(path.join(dir2, 'feed', 'images', 'ships', '99.webp'), 'old');
  const bad = new Map(withShips); bad.set('images/ships/7.webp', Buffer.from('evil!'));
  const r = await fetchFeedImages({ ...opts(dir2, bad), scope: 'ships' });
  assert.deepEqual([r.downloaded, r.remaining, r.failed], [0, 1, 1]);
  assert.equal(fs.existsSync(path.join(dir2, 'feed', 'images', 'ships', '7.webp')), false);
  assert.equal(fs.existsSync(path.join(dir2, 'feed', 'images', 'ships', '99.webp')), true, 'nothing is pruned while a picture is still missing');
  const ok = await fetchFeedImages({ ...opts(dir2, withShips), scope: 'ships' });
  assert.deepEqual(ok, { downloaded: 1, remaining: 0, failed: 0 });
  assert.equal(fs.existsSync(path.join(dir2, 'feed', 'images', 'ships', '99.webp')), false);
});

test('the restored cache keeps ship pictures up to 640 px and ship notes that name RSI addresses only', async () => {
  const { default: sharp } = await import('sharp');
  const cache = tmp();
  const folder = path.join(cache, 'images', 'ships');
  fs.mkdirSync(folder, { recursive: true });
  const webpOf = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#123456' } }).webp().toBuffer();
  fs.writeFileSync(path.join(folder, '1.webp'), await webpOf(640, 360));
  fs.writeFileSync(path.join(folder, '2.webp'), await webpOf(641, 360));
  fs.writeFileSync(path.join(folder, '3.webp'), Buffer.from('<html></html>'));
  fs.writeFileSync(path.join(folder, 'x.webp'), await webpOf(8, 8));
  const good = { ships: { 1: { page: 'https://robertsspaceindustries.com/en/pledge/ships/a/B', url: 'https://robertsspaceindustries.com/media/abc/source.jpg', checkedAt: '2026-11-20T10:00:00.000Z' } } };
  fs.writeFileSync(path.join(cache, 'ship-sources.json'), JSON.stringify(good));
  const r = await sanitizeFeedCache({ cacheDir: cache, sharp });
  assert.deepEqual(r.removed.map((n) => path.basename(n)).sort(), ['2.webp', '3.webp', 'x.webp']);
  assert.deepEqual(fs.readdirSync(folder), ['1.webp']);
  assert.deepEqual(r.shipSources, good);
  for (const bad of [{ ships: { 1: { url: 'https://evil.test/a.jpg' } } }, { ships: { 1: { page: 'https://evil.test/en/pledge/ships/a/B' } } }, { ships: { abc: {} } }, { ships: [] }, [], { ships: { 1: { page: 'not a url' } } }, { ships: { 1: { failedAt: 'tomorrow' } } }, { ships: { 1: { checkedAt: 5 } } }]) {
    fs.writeFileSync(path.join(cache, 'ship-sources.json'), JSON.stringify(bad));
    const again = await sanitizeFeedCache({ cacheDir: cache, sharp });
    assert.equal(again.shipSources, null, JSON.stringify(bad));
    assert.equal(fs.existsSync(path.join(cache, 'ship-sources.json')), false);
  }
});

test('buildFeed never signs a ship picture over the per-file cap', () => {
  const images = tmp();
  fs.mkdirSync(path.join(images, 'ships'), { recursive: true });
  const big = webp('x'); const body = Buffer.concat([big.subarray(0, big.length), Buffer.alloc(4 * 1024 * 1024)]);
  body.writeUInt32LE(body.length - 8, 4);
  fs.writeFileSync(path.join(images, 'ships', '4.webp'), body);
  const r = buildFeed({ outDir: path.join(tmp(), 'o'), privateKey: KEY.priv, publicKey: KEY.pub, events: { events: [] }, imagesDir: images, shipIds: [4] });
  assert.deepEqual([r.ships, r.rejectedImages], [0, ['ships/4.webp']]);
});
