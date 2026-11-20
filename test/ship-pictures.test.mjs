import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncShipPictures, fetchShipList, shipPictureName, sourcesNeedSave, MIN_SHIPS, RETRY_AFTER_MS, DATES_SAVE_MS } from '../src/ship-pictures.mjs';
import { QUERIES } from '../src/sync/queries.mjs';

const HOST = 'https://robertsspaceindustries.com';
const res = (status, { body = '', headers = {} } = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => body, arrayBuffer: async () => Buffer.from(body) });
const json = (v) => res(200, { body: JSON.stringify(v), headers: { 'content-type': 'application/json' } });
const imgRes = (bytes = 'IMG') => res(200, { body: bytes, headers: { 'content-type': 'image/jpeg' } });
const og = (u) => `<html><head><meta property="og:image" content="${u}" /></head></html>`;
const PIC = (id) => `${HOST}/media/pic${id}/source.jpg`;
/** A believable listing: ids 1..n, links /pledge/ships/m/Ship-<id>. */
const listing = (n = MIN_SHIPS + 2, extra = []) => [{ data: { ships: [...Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Ship ${i + 1}`, link: `/pledge/ships/m/Ship-${i + 1}` })), ...extra] } }];

/** A fake RSI: the listing POST, ship pages (/en/pledge/ships/m/Ship-<id>) and pictures (/media/...). */
function rsi(o = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') return o.list ? o.list(init) : json(listing(o.n));
    const m = /Ship-(\d+)$/.exec(url);
    if (m) return o.page ? o.page(Number(m[1]), url) : res(200, { body: og(PIC(m[1])) });
    return o.image ? o.image(url) : imgRes(`bytes of ${url}`);
  };
  return { fetch, calls };
}
function run(o = {}) {
  const { fetch, calls } = o.rsi ?? rsi(o);
  const sleeps = [], written = o.written ?? {}, removed = [], saves = [];
  const p = syncShipPictures({
    previous: o.previous ?? null, fetch, sleep: async (ms) => { sleeps.push(ms); },
    resize: o.resize ?? (async (b) => Buffer.from(`webp:${b}`)), writeImage: (n, b) => { written[n] = b; },
    exists: (n) => n in written, listImages: () => Object.keys(written), removeImage: (n) => { removed.push(n); delete written[n]; },
    now: () => o.now ?? '2026-11-20T10:00:00.000Z', save: (s) => saves.push(structuredClone(s)), recheck: o.recheck ?? 0, interval: 1000, imageInterval: 300, log: () => {}, cancelled: o.cancelled,
  });
  return p.then((r) => ({ r, calls, sleeps, written, removed, saves }));
}

test('the ship list is the pinned query posted anonymously to the upgrade tool, and its ships become { id, name, page }', async () => {
  const { fetch, calls } = rsi({ n: 25 });
  const ships = await fetchShipList({ fetch, sleep: async () => {}, interval: 1, log: () => {} });
  assert.equal(ships.length, 25);
  assert.deepEqual(ships[0], { id: 1, name: 'Ship 1', page: `${HOST}/en/pledge/ships/m/Ship-1` });
  const [call] = calls;
  assert.equal(call.url, `${HOST}/pledge-store/api/upgrade/v2/graphql`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.headers.cookie, undefined);
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.map((o) => [o.operationName, o.query === QUERIES.initShipUpgrade]), [['initShipUpgrade', true]]);
  assert.doesNotMatch(call.init.body, /mutation/i);
});

test('a listing that is short, has errors or is not JSON is refused; bad and repeated ids are skipped', async () => {
  const ctx = (list) => ({ ...rsi({ list }), sleep: async () => {}, interval: 1, log: () => {} });
  await assert.rejects(fetchShipList(ctx(() => json(listing(3)))), /too short/);
  await assert.rejects(fetchShipList(ctx(() => json([{ errors: [{ message: 'x' }], data: null }]))), /errors/);
  await assert.rejects(fetchShipList(ctx(() => res(200, { body: '<html>' }))), /not JSON/);
  await assert.rejects(fetchShipList(ctx(() => json({ ships: [] }))), /errors/);
  const ships = await fetchShipList(ctx(() => json(listing(MIN_SHIPS, [{ id: 'x', name: 'bad', link: '/pledge/ships/m/X' }, { id: 1, name: 'dup', link: '/pledge/ships/m/Ship-1' }, { id: 500, name: 'No link', link: 'https://evil.test/x' }]))));
  assert.equal(ships.length, MIN_SHIPS + 1);
  assert.equal(ships.find((s) => s.id === 500).page, null);
});

test('every new ship gets a page read, a picture download, a resize and a file ships/<id>.webp; pages are one second apart', async () => {
  const { r, calls, written, sleeps, saves } = await run({ n: MIN_SHIPS });
  assert.equal(r.ships, MIN_SHIPS);
  assert.equal(r.ids.length, MIN_SHIPS);
  assert.equal(r.downloaded, MIN_SHIPS);
  assert.deepEqual(Object.keys(written).sort(), Array.from({ length: MIN_SHIPS }, (_, i) => shipPictureName(i + 1)).sort());
  assert.equal(written['ships/3.webp'].toString(), `webp:bytes of ${PIC(3)}`);
  assert.deepEqual(r.sources.ships[3], { page: `${HOST}/en/pledge/ships/m/Ship-3`, url: PIC(3), checkedAt: '2026-11-20T10:00:00.000Z' });
  assert.equal(saves.length, MIN_SHIPS + 1, 'the notes are saved after every ship');
  for (const c of calls.slice(1)) {
    assert.equal(c.init.method, 'GET');
    assert.equal(c.init.credentials, 'omit');
    assert.ok(c.init.signal instanceof AbortSignal);
    assert.equal(new URL(c.url).origin, HOST, 'RSI only');
  }
  assert.ok(sleeps.filter((s) => s === 1000).length >= MIN_SHIPS, 'a second after each page');
});

test('a second run with everything cached makes only the listing request', async () => {
  const first = await run({ n: MIN_SHIPS });
  const second = await run({ n: MIN_SHIPS, written: first.written, previous: first.r.sources });
  assert.equal(second.calls.length, 1);
  assert.equal(second.r.fetched, 0);
  assert.equal(second.r.ids.length, MIN_SHIPS);
});

test('only the least recently checked known ships are looked at again, and a changed picture address is downloaded again', async () => {
  const first = await run({ n: MIN_SHIPS });
  const previous = structuredClone(first.r.sources);
  previous.ships[4].checkedAt = '2026-11-01T00:00:00.000Z';
  previous.ships[9].checkedAt = '2026-11-02T00:00:00.000Z';
  const changed = (id) => (id === 9 ? `${HOST}/media/new9/source.jpg` : PIC(id));
  const second = await run({ n: MIN_SHIPS, written: first.written, previous, recheck: 2, page: (id) => res(200, { body: og(changed(id)) }), image: (u) => imgRes(`new bytes of ${u}`) });
  const pages = second.calls.filter((c) => /Ship-\d+$/.test(c.url)).map((c) => Number(/\d+$/.exec(c.url)[0]));
  assert.deepEqual(pages, [4, 9]);
  assert.equal(second.calls.filter((c) => /\/media\//.test(c.url)).length, 1, 'ship 4 is unchanged: its picture is not fetched again');
  assert.equal(second.written['ships/9.webp'].toString(), 'webp:new bytes of https://robertsspaceindustries.com/media/new9/source.jpg');
  assert.equal(second.r.sources.ships[4].checkedAt, '2026-11-20T10:00:00.000Z');
});

test('a ship whose page or picture fails is noted, keeps what it had and is left alone for a day', async () => {
  const bad = (id) => id === 2;
  const a = await run({ n: MIN_SHIPS, page: (id) => (bad(id) ? res(404) : res(200, { body: og(PIC(id)) })) });
  assert.equal(a.r.failed, 1);
  assert.equal(a.r.ids.includes(2), false);
  assert.match(a.r.sources.ships[2].error, /HTTP 404/);
  const soon = await run({ n: MIN_SHIPS, written: a.written, previous: a.r.sources, now: '2026-11-20T20:00:00.000Z' });
  assert.equal(soon.calls.length, 1, 'still waiting');
  const later = await run({ n: MIN_SHIPS, written: a.written, previous: a.r.sources, now: new Date(Date.parse('2026-11-20T10:00:00.000Z') + RETRY_AFTER_MS + 1000).toISOString() });
  assert.equal(later.calls.length, 3, 'the listing, the page and the picture of ship 2');
  assert.equal(later.r.ids.includes(2), true);
  assert.equal(later.r.sources.ships[2].error, undefined);
  // A picture the page names off the RSI host is refused before any request, a non-image body and a failing resize leave no file.
  const off = await run({ n: MIN_SHIPS, page: (id) => res(200, { body: id === 1 ? og('https://evil.test/a.jpg') : og(PIC(id)) }) });
  assert.equal(off.written['ships/1.webp'], undefined);
  assert.ok(!off.calls.some((c) => c.url.includes('evil.test')));
  const notImage = await run({ n: MIN_SHIPS, image: (u) => (u.endsWith('pic1/source.jpg') ? res(200, { body: '<html>', headers: { 'content-type': 'text/html' } }) : imgRes()) });
  assert.equal(notImage.written['ships/1.webp'], undefined);
  const broken = await run({ n: MIN_SHIPS, resize: async (b) => { if (String(b).includes('pic2')) throw new Error('boom'); return Buffer.from('ok'); } });
  assert.equal(broken.written['ships/2.webp'], undefined);
  assert.match(broken.r.sources.ships[2].error, /resize failed: boom/);
});

test('three rate-limited ships in a row stop the run cleanly and the pictures so far stay', async () => {
  let n = 0;
  const { r, written } = await run({ n: 40, page: (id) => { n++; return id <= 5 ? res(200, { body: og(PIC(id)) }) : res(429); } });
  assert.equal(r.stopped, true);
  assert.equal(Object.keys(written).length, 5);
  assert.equal(r.sources.ships[6], undefined, 'a rate limit is not noted against the ship');
  assert.ok(n < 40);
});

test('ships RSI no longer lists lose their picture and note', async () => {
  const first = await run({ n: MIN_SHIPS + 3 });
  const second = await run({ n: MIN_SHIPS, written: first.written, previous: first.r.sources });
  assert.deepEqual(second.removed.sort(), ['ships/21.webp', 'ships/22.webp', 'ships/23.webp']); // 22 of 23 listed is a plausible full list
  assert.equal(second.r.sources.ships[22], undefined);
  assert.equal(second.r.ids.length, MIN_SHIPS);
});

test('a failing listing throws before anything is changed (the caller publishes the cache as it is)', async () => {
  const written = { 'ships/1.webp': Buffer.from('keep') };
  await assert.rejects(run({ written, list: () => res(500) }), /HTTP 500/);
  assert.deepEqual(Object.keys(written), ['ships/1.webp']);
});

test('a short listing (30 of 243) removes nothing and the feed still carries every cached picture', async () => {
  const first = await run({ n: 243 });
  assert.equal(first.r.ids.length, 243);
  const second = await run({ n: 30, written: first.written, previous: first.r.sources });
  assert.deepEqual(second.removed, []);
  assert.equal(Object.keys(second.written).length, 243);
  assert.equal(Object.keys(second.r.sources.ships).length, 243);
  assert.equal(second.r.ids.length, 243, 'all cached pictures are published again');
  // A plausible list (at least 80 % of what was known) does drop the ships that are gone.
  const third = await run({ n: 200, written: first.written, previous: first.r.sources });
  assert.equal(third.removed.length, 43);
});

test('the listing request is followed by a second of quiet before the first page', async () => {
  const order = [];
  const { fetch } = rsi({ n: MIN_SHIPS });
  await syncShipPictures({ fetch: async (u, i) => { order.push(i.method === 'POST' ? 'list' : 'get'); return fetch(u, i); }, sleep: async (ms) => { order.push(`sleep${ms}`); }, resize: async (b) => b, writeImage: () => {}, exists: () => false, interval: 1000, log: () => {} });
  assert.deepEqual(order.slice(0, 3), ['list', 'sleep1000', 'get']);
});

test('the recheck rotation moves on across runs when the notes are persisted, and a future failure date holds nothing back', async () => {
  const first = await run({ n: MIN_SHIPS });
  let persisted = first.r.sources;
  const seen = new Set();
  for (let day = 1; day <= 4; day++) {
    const now = new Date(Date.parse('2026-11-20T10:00:00.000Z') + day * 86400000).toISOString();
    const r = await run({ n: MIN_SHIPS, written: first.written, previous: persisted, recheck: 5, now });
    for (const c of r.calls.filter((c) => /Ship-\d+$/.test(c.url))) seen.add(Number(/\d+$/.exec(c.url)[0]));
    persisted = r.r.sources;
  }
  assert.equal(seen.size, MIN_SHIPS, 'every ship was looked at within four days');
  const future = structuredClone(first.r.sources);
  future.ships[3] = { ...future.ships[3], failedAt: '2030-01-01T00:00:00.000Z' };
  delete first.written['ships/3.webp'];
  const r = await run({ n: MIN_SHIPS, written: first.written, previous: future });
  assert.equal(r.r.ids.includes(3), true);
});

test('sourcesNeedSave: a changed address or dates older than the save interval make the cache worth saving, fresh dates alone do not', () => {
  const doc = (url, at) => ({ ships: { 1: { url, checkedAt: at } } });
  const T = Date.parse('2026-11-20T10:00:00.000Z');
  const at = (ms) => new Date(T - ms).toISOString();
  assert.equal(sourcesNeedSave(doc('u', at(3600000)), doc('u', at(0)), T), false);
  assert.equal(sourcesNeedSave(doc('u', at(DATES_SAVE_MS + 1000)), doc('u', at(0)), T), true);
  assert.equal(sourcesNeedSave(doc('u', at(1000)), doc('v', at(0)), T), true);
  assert.equal(sourcesNeedSave(null, doc('u', at(0)), T), true);
  assert.equal(sourcesNeedSave(doc('u', at(-86400000)), doc('u', at(0)), T), true, 'a date in the future is stale');
});
