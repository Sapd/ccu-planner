import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncImages } from '../src/image-sync.mjs';

const OG = (u) => `<meta property="og:image" content="${u}" />`;
const IMG = (n) => `https://robertsspaceindustries.com/i/${n}/source.jpg`;
const res = (status, { body = '', headers = {} } = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => body, arrayBuffer: async () => Buffer.from(body) });
const imgRes = (bytes = 'IMG', headers = {}) => res(200, { body: bytes, headers: { 'content-type': 'image/jpeg', ...headers } });
const ship = (id) => ({ id, name: `S${id}`, page: `https://robertsspaceindustries.com/en/pledge/ships/x/S${id}` });
const run = (o) => {
  const sleeps = [], calls = [];
  const written = {};
  // Page requests go to o.fetch; image requests (/i/...) to o.image, a plain image by default.
  const fetch = async (url, opts) => { calls.push({ url, opts }); return url.includes('/i/') ? (o.image ? o.image(url, calls.length) : imgRes()) : o.fetch(url, calls.length); };
  const store = o.store ?? { images: {} };
  const resize = o.resize ?? (async (buf) => ({ s: Buffer.from(`s:${buf}`), l: Buffer.from(`l:${buf}`) }));
  const p = syncImages({ ships: o.ships ?? [ship(1)], store, fetch, sleep: async (ms) => { sleeps.push(ms); }, now: () => 'T', save: o.save, limit: o.limit, refresh: o.refresh, resize, writeImage: (n, b) => { written[n] = b; }, exists: o.exists ?? ((n) => n in written) });
  return p.then((r) => ({ r, store, sleeps, calls, written }));
};

test('success stores url, page and time; every request has a timeout signal and no cookies', async () => {
  const { r, store, calls } = await run({ fetch: () => res(200, { body: OG(IMG('a')) }) });
  assert.deepEqual(store.images[1], { url: IMG('a'), page: ship(1).page, fetchedAt: 'T', thumbs: { s: '1-s.webp', l: '1-l.webp', sourceUrl: IMG('a'), bytes: 10 } });
  assert.equal(r.ok, 1);
  assert.ok(calls[0].opts.signal instanceof AbortSignal);
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.equal(calls[0].opts.headers.cookie, undefined);
});

test('an off-host redirect is refused and not followed', async () => {
  const { store, calls } = await run({ fetch: () => res(302, { headers: { location: 'https://evil.test/x' } }) });
  assert.equal(calls.length, 1);
  assert.equal(store.images[1].url, null);
  assert.match(store.images[1].error, /off host/);
});

test('a same-host redirect is followed after a pause', async () => {
  const { store, calls, sleeps } = await run({ fetch: (u, n) => (n === 1 ? res(301, { headers: { location: '/en/other' } }) : res(200, { body: OG(IMG('r')) })) });
  assert.equal(calls[1].url, 'https://robertsspaceindustries.com/en/other');
  assert.equal(store.images[1].url, IMG('r'));
  assert.deepEqual(sleeps, [1000, 1000]); // redirect hop, then page -> image
});

test('429 then 200 succeeds after the back-off', async () => {
  const { store, sleeps } = await run({ fetch: (u, n) => (n === 1 ? res(429) : res(200, { body: OG(IMG('b')) })) });
  assert.equal(store.images[1].url, IMG('b'));
  assert.deepEqual(sleeps, [5000, 1000]);
});

test('3 consecutive exhausted 429s stop the run, and the entries are saved', async () => {
  const saved = [];
  const { r, store, calls } = await run({ ships: [1, 2, 3, 4, 5].map(ship), fetch: () => res(429), save: (s) => saved.push(Object.keys(s.images).length) });
  assert.equal(r.stopped, true);
  assert.equal(r.fetched, 3);
  assert.equal(calls.length, 15);
  assert.equal(store.images[4], undefined);
  assert.deepEqual(saved, [1, 2, 3]);
});

test('an exhausted 429 followed by a success does not stop the run', async () => {
  let n429 = 0;
  const { r } = await run({ ships: [1, 2, 3, 4].map(ship), fetch: (u) => { if (u.endsWith('S1') && n429 < 5) { n429++; return res(429); } return res(200, { body: OG(IMG('z')) }); } });
  assert.equal(r.stopped, false);
  assert.equal(r.ok, 3);
});

test('a failed refresh keeps the old url and records the error', async () => {
  const store = { images: { 1: { url: IMG('old'), page: 'p', fetchedAt: 'old' } } };
  const { store: s } = await run({ store, refresh: true, fetch: () => res(500) });
  assert.equal(s.images[1].url, IMG('old'));
  assert.equal(s.images[1].error, 'HTTP 500');
  assert.equal(s.images[1].errorAt, 'T');
  assert.equal(s.images[1].fetchedAt, 'old');
});

test('a thrown fetch (timeout) is an ordinary failure; a later success clears the error', async () => {
  const store = { images: {} };
  await run({ store, fetch: () => { throw new DOMException('timed out', 'TimeoutError'); } });
  assert.equal(store.images[1].url, null);
  assert.match(store.images[1].error, /timed out/);
  const { r } = await run({ store, fetch: () => res(200, { body: OG(IMG('c')) }) });
  assert.equal(r.fetched, 1);
  assert.deepEqual(store.images[1], { url: IMG('c'), page: ship(1).page, fetchedAt: 'T', thumbs: { s: '1-s.webp', l: '1-l.webp', sourceUrl: IMG('c'), bytes: 10 } });
});

test('ships with a url are skipped without refresh, taken with it', async () => {
  const store = { images: { 1: { url: IMG('k'), thumbs: { s: '1-s.webp', l: '1-l.webp', sourceUrl: IMG('k'), bytes: 1 } } } };
  const a = await run({ store, ships: [ship(1), ship(2)], exists: () => true, fetch: () => res(200, { body: OG(IMG('n')) }) });
  assert.equal(a.calls.length, 2); // ship 2: page + image
  const b = await run({ store, ships: [ship(1), ship(2)], refresh: true, fetch: () => res(200, { body: OG(IMG('m')) }) });
  assert.equal(b.calls.length, 4);
});

test('limit is respected', async () => {
  const { calls, store } = await run({ ships: [1, 2, 3, 4].map(ship), limit: 2, fetch: () => res(200, { body: OG(IMG('l')) }) });
  assert.equal(calls.length, 4);
  assert.deepEqual(Object.keys(store.images), ['1', '2']);
});

test('a page without og:image is recorded as a failure', async () => {
  const { store } = await run({ fetch: () => res(200, { body: '<html></html>' }) });
  assert.equal(store.images[1].error, 'no og:image');
});

test('both WebP files are written through resize and recorded as thumbs', async () => {
  const { written, store } = await run({ fetch: () => res(200, { body: OG(IMG('w')) }), image: () => imgRes('PIX') });
  assert.deepEqual(Object.keys(written).sort(), ['1-l.webp', '1-s.webp']);
  assert.equal(written['1-s.webp'].toString(), 's:PIX');
  assert.equal(written['1-l.webp'].toString(), 'l:PIX');
  assert.deepEqual(store.images[1].thumbs, { s: '1-s.webp', l: '1-l.webp', sourceUrl: IMG('w'), bytes: 10 });
});

test('an unchanged source url with existing files is not downloaded again', async () => {
  const thumbs = { s: '1-s.webp', l: '1-l.webp', sourceUrl: IMG('u'), bytes: 1 };
  const store = { images: { 1: { url: IMG('u'), page: 'p', fetchedAt: 'old', thumbs } } };
  const { calls, r } = await run({ store, exists: () => true, fetch: () => res(500) });
  assert.equal(calls.length, 0);
  assert.equal(r.fetched, 0);
});

test('missing files are filled in without another page fetch; a changed source url is redownloaded', async () => {
  const thumbs = { s: '1-s.webp', l: '1-l.webp', sourceUrl: IMG('u'), bytes: 1 };
  const store = { images: { 1: { url: IMG('u'), page: 'p', fetchedAt: 'old', thumbs } } };
  const a = await run({ store, exists: () => false, fetch: () => res(500) });
  assert.deepEqual(a.calls.map((c) => c.url), [IMG('u')]);
  assert.deepEqual(Object.keys(a.written).sort(), ['1-l.webp', '1-s.webp']);
  const store2 = { images: { 1: { url: IMG('new'), page: 'p', fetchedAt: 'old', thumbs } } };
  const b = await run({ store: store2, exists: () => true, fetch: () => res(500) });
  assert.deepEqual(b.calls.map((c) => c.url), [IMG('new')]);
  assert.equal(store2.images[1].thumbs.sourceUrl, IMG('new'));
});

test('a refresh whose page url is unchanged still re-downloads the image', async () => {
  const thumbs = { s: '1-s.webp', l: '1-l.webp', sourceUrl: IMG('u'), bytes: 1 };
  const store = { images: { 1: { url: IMG('u'), page: 'p', fetchedAt: 'old', thumbs } } };
  const { calls } = await run({ store, refresh: true, exists: () => true, fetch: () => res(200, { body: OG(IMG('u')) }) });
  assert.equal(calls.length, 2);
});

test('a non-image content-type, an off-host image redirect and an oversized body write nothing', async () => {
  const cases = {
    'not an image': () => res(200, { body: 'x', headers: { 'content-type': 'text/html' } }),
    'redirect off host': () => res(302, { headers: { location: 'https://evil.test/a.jpg' } }),
    'image too large': () => imgRes('x', { 'content-length': String(21 * 1024 * 1024) }),
  };
  for (const [msg, image] of Object.entries(cases)) {
    const { written, store } = await run({ fetch: () => res(200, { body: OG(IMG('x')) }), image });
    assert.deepEqual(written, {}, msg);
    assert.match(store.images[1].error, new RegExp(msg), msg);
    assert.equal(store.images[1].url, IMG('x'));
    assert.equal(store.images[1].thumbs, undefined);
  }
  // A body over the cap with no content-length header.
  const big = { status: 200, ok: true, headers: { get: (k) => ({ 'content-type': 'image/png' })[k.toLowerCase()] ?? null }, arrayBuffer: async () => new ArrayBuffer(21 * 1024 * 1024) };
  const { written, store } = await run({ fetch: () => res(200, { body: OG(IMG('x')) }), image: () => big });
  assert.deepEqual(written, {});
  assert.match(store.images[1].error, /too large/);
});

test('a failing resize writes nothing and keeps the url; the next run retries only the image', async () => {
  const store = { images: {} };
  const a = await run({ store, fetch: () => res(200, { body: OG(IMG('x')) }), resize: async () => { throw new Error('bad data'); } });
  assert.deepEqual(a.written, {});
  assert.match(store.images[1].error, /resize failed: bad data/);
  const b = await run({ store, exists: () => false, fetch: () => res(500) });
  assert.deepEqual(b.calls.map((c) => c.url), [IMG('x')]);
  assert.equal(store.images[1].error, undefined);
  assert.ok(store.images[1].thumbs);
});

test('image requests carry the same safety options and stay off cookies', async () => {
  const { calls } = await run({ fetch: () => res(200, { body: OG(IMG('x')) }) });
  const o = calls[1].opts;
  assert.ok(o.signal instanceof AbortSignal);
  assert.equal(o.credentials, 'omit');
  assert.equal(o.redirect, 'manual');
  assert.equal(o.headers.cookie, undefined);
});

test('a stored off-host image url makes no request, records an error and writes nothing', async () => {
  for (const bad of ['https://evil.test/x.jpg', 'http://robertsspaceindustries.com/i/x.jpg', 'https://robertsspaceindustries.com.evil.test/x.jpg']) {
    const store = { images: { 1: { url: bad, page: 'p', fetchedAt: 'old' } } };
    const { calls, written } = await run({ store, fetch: () => res(500) });
    assert.equal(calls.length, 0, bad);
    assert.deepEqual(written, {});
    assert.match(store.images[1].error, /not on the RSI host/);
    assert.equal(store.images[1].thumbs, undefined);
  }
});

test('a streamed body over the cap is cancelled mid-read and writes nothing', async () => {
  let cancelled = false, reads = 0;
  const chunk = new Uint8Array(8 * 1024 * 1024);
  const reader = { read: async () => { reads++; return { done: false, value: chunk }; }, cancel: async () => { cancelled = true; } };
  const streamed = { status: 200, ok: true, headers: { get: (k) => ({ 'content-type': 'image/png' })[k.toLowerCase()] ?? null }, body: { getReader: () => reader } };
  const { written, store } = await run({ fetch: () => res(200, { body: OG(IMG('x')) }), image: () => streamed });
  assert.equal(cancelled, true);
  assert.equal(reads, 3); // 8 + 16 + 24 MB: stops at the first read past 20 MB
  assert.deepEqual(written, {});
  assert.match(store.images[1].error, /too large/);
  assert.equal(store.images[1].thumbs, undefined);
});
