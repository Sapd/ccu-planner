import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncCatalog } from '../src/catalog-sync.mjs';
import { validateRequest } from '../src/sync/policy.mjs';
import { CATALOG_QUERY, CATALOG_OPERATION, CATALOG_PRODUCTS, CATALOG_FACETS, catalogBody } from '../src/sync/catalog-query.mjs';
import { assessCatalog, fetchItems, shortListings } from '../src/sync/catalog-fetch.mjs';
import { parseResource, classifyResource, readCatalog, rsiPageUrl, rsiThumbUrl, categoryFromUrl, CATALOG_CATEGORIES } from '../src/logic/store-catalog.mjs';

// ---- policy ----
test('policy allows exactly the pinned catalog request', () => {
  validateRequest('POST', '/graphql', catalogBody([72], 1));
  validateRequest('POST', '/graphql', catalogBody([9, 45, 46], 3));
  validateRequest('POST', '/graphql', catalogBody([289], 1, { facet: 'extras-gear', tag: 'filters-gear-armor' }));
});

test('policy rejects a mutation, another path, another query, another method and a changed shape', () => {
  const ok = catalogBody([72], 1);
  const bad = (method, path, body) => assert.throws(() => validateRequest(method, path, body), /not allowlisted/);
  bad('POST', '/graphql', { ...ok, query: 'mutation { addToCart(id: 1) { id } }' });
  bad('POST', '/graphql', { ...ok, query: `${CATALOG_QUERY}\nmutation { x }` });
  bad('POST', '/graphql', { ...ok, query: CATALOG_QUERY.replace('amount', 'amount price') });
  bad('POST', '/graphql', { ...ok, operationName: 'addToCart' });
  bad('POST', '/graphql', { operationName: CATALOG_OPERATION, query: CATALOG_QUERY, variables: { query: { limit: 100, page: 1, skus: { products: [72] }, sort: { direction: 'desc', field: 'weight' } } }, extensions: {} });
  bad('POST', '/graphql', [ok]);
  bad('POST', '/graphql', null);
  bad('POST', '/api/graphql', ok);
  bad('POST', '/graphql/', ok);
  bad('POST', '/pledge-store/api/graphql', ok);
  bad('GET', '/graphql', ok);
  bad('PUT', '/graphql', ok);
  bad('DELETE', '/graphql', ok);
  const v = (patch) => ({ ...ok, variables: { query: { ...ok.variables.query, ...patch } } });
  bad('POST', '/graphql', v({ limit: 1000 }));
  bad('POST', '/graphql', v({ page: 0 }));
  bad('POST', '/graphql', v({ page: 'x' }));
  bad('POST', '/graphql', v({ sort: { direction: 'asc', field: 'weight' } }));
  bad('POST', '/graphql', v({ skus: { products: [] } }));
  bad('POST', '/graphql', v({ skus: { products: ['72'] } }));
  bad('POST', '/graphql', v({ skus: { products: [72], extra: 1 } }));
  bad('POST', '/graphql', v({ skus: { products: [72], filtersFromTags: { facetIdentifiers: ['a b'], tagIdentifiers: ['x'] } } }));
  bad('POST', '/graphql', v({ skus: { products: [72], filtersFromTags: { facetIdentifiers: ['a', 'b'], tagIdentifiers: ['x'] } } }));
  // Only RSI's own product ids and tag facets may be asked for.
  bad('POST', '/graphql', v({ skus: { products: [73] } }));
  bad('POST', '/graphql', v({ skus: { products: [72, 99999] } }));
  bad('POST', '/graphql', v({ skus: { products: [289], filtersFromTags: { facetIdentifiers: ['extras-gear'], tagIdentifiers: ['filters-paint-premium'] } } }));
  bad('POST', '/graphql', v({ skus: { products: [289], filtersFromTags: { facetIdentifiers: ['unknown'], tagIdentifiers: ['filters-gear-armor'] } } }));
});

test('the allowed product ids and facets are exactly the categories', () => {
  assert.deepEqual([...new Set(CATALOG_CATEGORIES.flatMap((c) => c.products))].sort((a, b) => a - b), CATALOG_PRODUCTS);
  assert.deepEqual(Object.fromEntries(CATALOG_CATEGORIES.filter((c) => c.facet).map((c) => [c.facet.id, c.facet.subs.map((s) => s.tag)])), CATALOG_FACETS);
});

test('the pinned query has no mutation and stays read-only', () => {
  assert.doesNotMatch(CATALOG_QUERY, /mutation|subscription/i);
  assert.match(CATALOG_QUERY, /^query GetBrowseSkusByFilter\(/);
});

// ---- parsing ----
const raw = (o = {}) => ({ id: '17432', title: '890 Jump', name: '890 Jump', url: '/pledge/Standalone-Ships/890-Jump', media: { thumbnail: { storeSmall: 'https://media.robertsspaceindustries.com/abc/store_small.jpg' } },
  nativePrice: { amount: 95000, discounted: null }, stock: { unlimited: true, available: true, qty: 0 }, tags: [{ name: 'Limited Time' }], isWarbond: false, isPackage: false, isVip: false, ...o });

test('parseResource keeps USD cents, flags and a full RSI page url', () => {
  const i = parseResource(raw({ nativePrice: { amount: 6000, discounted: 4500 }, isWarbond: true }), { key: 'ships' });
  assert.deepEqual(i, { id: 17432, title: '890 Jump', category: 'ships', sub: null, subs: [], url: 'https://robertsspaceindustries.com/pledge/Standalone-Ships/890-Jump',
    thumbUrl: 'https://media.robertsspaceindustries.com/abc/store_small.jpg', thumb: null, priceCents: 6000, saleCents: 4500, warbond: true, limited: true, vip: false, subscriber: false, package: false,
    stock: { unlimited: true, available: true, qty: 0 }, tags: ['Limited Time'] });
});

test('parseResource: a discounted value that is not lower is no sale; a relative thumbnail resolves on the main host; vip is kept', () => {
  assert.equal(parseResource(raw({ nativePrice: { amount: 1000, discounted: 1000 } }), { key: 'gear' }).saleCents, null);
  assert.equal(parseResource(raw({ media: { thumbnail: { storeSmall: '/media/x/store_small/a.png' } } }), { key: 'giftcards' }).thumbUrl, 'https://robertsspaceindustries.com/media/x/store_small/a.png');
  assert.equal(parseResource(raw({ isVip: true }), { key: 'packs' }).vip, true);
});

test('parseResource drops entries without an id, title, RSI page or price, and refuses foreign pictures', () => {
  const reasons = [[{ id: 'x' }, 'no id'], [{ id: 0 }, 'no id'], [{ title: '', name: '' }, 'no title'], [{ url: 'https://evil.test/pledge/x' }, 'no store page'], [{ url: 'http://robertsspaceindustries.com/pledge/x' }, 'no store page'], [{ url: '//evil.test/x' }, 'no store page'], [{ nativePrice: { amount: null } }, 'no price'], [{ nativePrice: { amount: -5 } }, 'no price']];
  for (const [bad, reason] of reasons) {
    assert.equal(parseResource(raw(bad), { key: 'ships' }), null, JSON.stringify(bad));
    assert.deepEqual(classifyResource(raw(bad), { key: 'ships' }), { reason }, JSON.stringify(bad));
  }
  for (const u of ['https://evil.test/a.jpg', 'http://media.robertsspaceindustries.com/a.jpg', 'https://robertsspaceindustries.com.evil.test/a.jpg', 'https://user@media.robertsspaceindustries.com/a.jpg', 'javascript:alert(1)', '', null]) {
    assert.equal(rsiThumbUrl(u), null, String(u));
    assert.equal(parseResource(raw({ media: { thumbnail: { storeSmall: u } } }), { key: 'ships' }).thumbUrl, null);
  }
  assert.equal(rsiPageUrl('https://media.robertsspaceindustries.com/x'), null);
});

test('an item page is a store page only: no account, API or other path, no query, no fragment', () => {
  assert.equal(rsiPageUrl('/pledge/Gear/Neonwave-Bundle-Warbond'), 'https://robertsspaceindustries.com/pledge/Gear/Neonwave-Bundle-Warbond');
  for (const u of ['/en/account/logout', 'https://robertsspaceindustries.com/en/account/pledges', '/graphql', '/pledge/', '/pledge', '/pledge/Gear/X?x=1', '/pledge/Gear/X#top', '/api/pledge/x', 'https://robertsspaceindustries.com:8443/pledge/x']) assert.equal(rsiPageUrl(u), null, u);
});

test('a picture is on the media host (any path) or under /i/ or /media/ of the main host', () => {
  assert.ok(rsiThumbUrl('https://media.robertsspaceindustries.com/anything/at/all.jpg'));
  assert.ok(rsiThumbUrl('https://robertsspaceindustries.com/i/abc/store_small.jpg'));
  assert.ok(rsiThumbUrl('/media/x/store_small/a.png'));
  for (const u of ['https://robertsspaceindustries.com/en/account/logout', 'https://robertsspaceindustries.com/graphql', 'https://robertsspaceindustries.com/pledge/x']) assert.equal(rsiThumbUrl(u), null, u);
});

test('subscriber items take their kind from the store path', () => {
  assert.equal(categoryFromUrl('/pledge/Gear/X'), 'gear');
  assert.equal(categoryFromUrl('/pledge/Standalone-Ships/X'), 'ships');
  assert.equal(categoryFromUrl('/pledge/Add-Ons/X'), 'addons');
  assert.equal(categoryFromUrl('/pledge/Whatever/X'), 'other');
  const i = parseResource(raw({ url: '/pledge/Gear/Sub-Thing' }), { key: 'subscriber', subscriber: true });
  assert.equal(i.category, 'gear');
  assert.equal(i.subscriber, true);
});

test('readCatalog coerces tags, stock and subs, and reads the signed-in flag and the completeness figures', () => {
  const good = parseResource(raw(), { key: 'gear' });
  const doc = readCatalog({ fetchedAt: 'T', signedIn: true, droppedCount: 3, categories: { ships: { expected: 5, got: 4 }, bad: { expected: 'x' } },
    items: [{ ...good, tags: 5, stock: 'x', sub: 'armor', subs: undefined }, { ...good, id: 2, tags: ['a', 7, null], subs: ['armor', 3] }] });
  assert.equal(doc.signedIn, true);
  assert.equal(doc.droppedCount, 3);
  assert.deepEqual(doc.categories, { ships: { expected: 5, got: 4 } });
  assert.deepEqual(doc.items[0].tags, []);
  assert.deepEqual(doc.items[0].stock, {});
  assert.deepEqual(doc.items[0].subs, ['armor']);
  assert.deepEqual(doc.items[1].tags, ['a']);
  assert.deepEqual(doc.items[1].subs, ['armor']);
  assert.equal(readCatalog({ items: [], signedIn: 'yes' }).signedIn, false);
});

test('readCatalog keeps only well-formed items', () => {
  const good = parseResource(raw(), { key: 'ships' });
  const doc = { fetchedAt: 'T', items: [good, { id: 1 }, null, { ...good, url: 'https://evil.test/x' }, { ...good, thumb: '../x.webp' }] };
  assert.deepEqual(readCatalog(doc), { fetchedAt: 'T', signedIn: false, categories: {}, droppedCount: 0, items: [good] });
  assert.equal(readCatalog(null), null);
  assert.equal(readCatalog({ items: 5 }), null);
});

// ---- the sync loop ----
const res = (status, { json, headers = {}, bytes } = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, arrayBuffer: async () => Buffer.from(bytes ?? (json === undefined ? '' : JSON.stringify(json))) });
const listingOf = (resources, total = resources.length) => res(200, { json: { data: { store: { listing: { resources, count: resources.length, totalCount: total } } } } });
const picture = (b = 'IMG') => res(200, { bytes: b, headers: { 'content-type': 'image/jpeg' } });

function run(o = {}) {
  const calls = [], sleeps = [], written = {}, saves = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') return (o.post ?? ((body, n) => listingOf(o.listings?.[JSON.stringify(body.variables.query.skus)] ?? [])))(JSON.parse(init.body), calls.length);
    return (o.image ?? (() => picture()))(url, calls.length);
  };
  const removed = [];
  const p = syncCatalog({ previous: o.previous ?? null, post: o.signedPost, signedIn: o.signedIn, listImages: o.listImages, removeImage: (n) => removed.push(n), fetch, sleep: async (ms) => { sleeps.push(ms); }, now: () => 'T', save: (c) => saves.push(structuredClone(c)), resize: async (b) => Buffer.from(`w:${b}`),
    writeImage: (n, b) => { written[n] = b; }, exists: o.exists ?? ((n) => n in written), images: o.images, cancelled: o.cancelled, imageInterval: 50 });
  return p.then((r) => ({ r, calls, sleeps, written, saves, removed }), (error) => ({ error, calls, sleeps, written, saves, removed }));
}
const key = (products, tag) => JSON.stringify({ products, ...(tag ? { filtersFromTags: { facetIdentifiers: [tag[0]], tagIdentifiers: [tag[1]] } } : {}) });

test('sync: every request is the allowlisted POST /graphql without cookies, spaced one second apart, with a timeout', async () => {
  const { r, calls, sleeps } = await run({ listings: { [key([72])]: [raw()] }, images: false });
  assert.equal(r.items, 1);
  assert.ok(calls.length > 5);
  for (const c of calls) {
    assert.equal(c.url, 'https://robertsspaceindustries.com/graphql');
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.credentials, 'omit');
    assert.ok(c.init.signal instanceof AbortSignal);
    assert.equal(c.init.headers.cookie, undefined);
    assert.equal(c.init.headers['x-csrf-token'], undefined);
    validateRequest('POST', '/graphql', JSON.parse(c.init.body));
  }
  assert.equal(sleeps.filter((s) => s === 1000).length, calls.length - 1);
});

test('sync: pages of 100 continue until a page is not full; sub-categories are tagged from the facet queries', async () => {
  const full = Array.from({ length: 100 }, (_, i) => raw({ id: String(1000 + i), title: `P${i}`, url: `/pledge/Paints/P${i}` }));
  const rest = [raw({ id: '2000', title: 'Q', url: '/pledge/Paints/Q' })];
  const { r, calls, saves } = await run({
    images: false,
    post: (body) => {
      const s = body.variables.query.skus, page = body.variables.query.page;
      if (s.products[0] === 268 && !s.filtersFromTags) return listingOf(page === 1 ? full : rest, 101);
      if (s.products[0] === 268 && s.filtersFromTags.tagIdentifiers[0] === 'filters-paint-premium') return listingOf([rest[0], full[0]]);
      if (s.products[0] === 289 && !s.filtersFromTags) return listingOf([raw({ id: '3000', title: 'Armor', url: '/pledge/Gear/A' })]);
      if (s.products[0] === 289 && s.filtersFromTags.tagIdentifiers[0] === 'filters-gear-armor') return listingOf([raw({ id: '3000' })]);
      return listingOf([]);
    } });
  assert.equal(r.items, 102);
  assert.equal(calls.filter((c) => JSON.parse(c.init.body).variables.query.page === 2).length, 1);
  const last = saves.at(-1);
  assert.equal(last.items.find((i) => i.id === 2000).sub, 'premium');
  assert.equal(last.items.find((i) => i.id === 1000).sub, 'premium');
  assert.equal(last.items.find((i) => i.id === 1001).sub, null);
  assert.deepEqual(last.items.find((i) => i.id === 1001).subs, []);
  assert.equal(last.items.find((i) => i.id === 3000).sub, 'armor');
  assert.equal(last.fetchedAt, 'T');
});

test('sync: an item in two tag facets keeps both sub-categories', async () => {
  const { saves } = await run({ images: false, post: (body) => {
    const s = body.variables.query.skus;
    if (s.products[0] === 289 && !s.filtersFromTags) return listingOf([raw({ id: '3000', title: 'Armor', url: '/pledge/Gear/A' })]);
    if (s.products[0] === 289) return listingOf([raw({ id: '3000' })]);
    return listingOf([]);
  } });
  assert.deepEqual(saves.at(-1).items[0].subs, ['armor', 'clothing', 'equipment']);
  assert.equal(saves.at(-1).items[0].sub, 'armor');
});

test('sync: an item listed twice is one item whose flags add up', async () => {
  const { saves } = await run({ images: false, listings: { [key([72])]: [raw({ id: '5' })], [key([65])]: [raw({ id: '5', isVip: true, url: '/pledge/Standalone-Ships/890-Jump' })] } });
  const items = saves.at(-1).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].category, 'ships');
  assert.equal(items[0].subscriber, true);
  assert.equal(items[0].vip, true);
});

test('sync: a failed listing writes nothing', async () => {
  const { error, saves } = await run({ post: (body, n) => (n === 3 ? res(500) : listingOf([raw()])) });
  assert.match(error.message, /HTTP 500/);
  assert.equal(saves.length, 0);
});

test('sync: a GraphQL error, a redirect and a non-JSON answer are failures', async () => {
  assert.match((await run({ post: () => res(200, { json: { errors: [{ message: 'nope' }] } }) })).error.message, /refused: nope/);
  assert.match((await run({ post: () => res(302, { headers: { location: 'https://evil.test/' } }) })).error.message, /unexpected redirect/);
  assert.match((await run({ post: () => res(200, { bytes: '<html>' }) })).error.message, /not JSON/);
  assert.match((await run({ post: () => res(200, { bytes: 'x'.repeat(21 * 1024 * 1024) }) })).error.message, /listing too large/);
  assert.match((await run({ post: () => res(200, { json: { data: null } }) })).error.message, /no resources/);
});

test('sync: 429 backs off and then continues', async () => {
  let n = 0;
  const { r, sleeps } = await run({ images: false, post: () => (++n === 1 ? res(429, { headers: { 'retry-after': '7' } }) : listingOf([raw()])) });
  assert.ok(r.items >= 1);
  assert.ok(sleeps.includes(7000));
});

test('sync: five 429s in a row end the sync with an error and no file', async () => {
  const { error, saves } = await run({ post: () => res(429) });
  assert.match(error.message, /429/);
  assert.equal(saves.length, 0);
});

test('sync: a picture is downloaded once per address, written per item, and only from RSI hosts', async () => {
  const a = raw({ id: '1' }), b = raw({ id: '2', title: 'B', url: '/pledge/Standalone-Ships/B' }), c = raw({ id: '3', title: 'C', url: '/pledge/Standalone-Ships/C', media: { thumbnail: { storeSmall: 'https://evil.test/x.jpg' } } });
  const { r, calls, written, saves } = await run({ listings: { [key([72])]: [a, b, c] } });
  const gets = calls.filter((x) => x.init.method === 'GET');
  assert.equal(gets.length, 1);
  assert.equal(gets[0].url, 'https://media.robertsspaceindustries.com/abc/store_small.jpg');
  assert.equal(gets[0].init.credentials, 'omit');
  assert.deepEqual(Object.keys(written).sort(), ['catalog/1.webp', 'catalog/2.webp']);
  assert.equal(r.thumbs, 2);
  const items = saves.at(-1).items;
  assert.equal(items.find((i) => i.id === 3).thumb, null);
  assert.equal(items.find((i) => i.id === 3).thumbUrl, null);
});

test('sync: pictures already on disk for the same address are kept; a changed address or a missing file is fetched again', async () => {
  const a = raw({ id: '1' }), b = raw({ id: '2', title: 'B', url: '/pledge/Standalone-Ships/B', media: { thumbnail: { storeSmall: 'https://media.robertsspaceindustries.com/new/store_small.jpg' } } });
  const prev = (id, url, thumb) => ({ id, thumbUrl: url, thumb });
  const previous = { items: [prev(1, 'https://media.robertsspaceindustries.com/abc/store_small.jpg', 'catalog/1.webp'), prev(2, 'https://media.robertsspaceindustries.com/old/store_small.jpg', 'catalog/2.webp')] };
  const { r, calls } = await run({ previous, listings: { [key([72])]: [a, b] }, exists: () => true });
  assert.equal(calls.filter((x) => x.init.method === 'GET').length, 1);
  assert.equal(r.thumbs, 2);
  const again = await run({ previous, listings: { [key([72])]: [a, b] }, exists: () => false });
  assert.equal(again.calls.filter((x) => x.init.method === 'GET').length, 2);
});

test('sync: a bad picture is counted and skipped, not fatal; non-images and redirects off host are refused', async () => {
  const items = [raw({ id: '1' }), raw({ id: '2', title: 'B', url: '/pledge/Standalone-Ships/B', media: { thumbnail: { storeSmall: 'https://media.robertsspaceindustries.com/b/s.jpg' } } }), raw({ id: '3', title: 'C', url: '/pledge/Standalone-Ships/C', media: { thumbnail: { storeSmall: 'https://media.robertsspaceindustries.com/c/s.jpg' } } })];
  const { r } = await run({ listings: { [key([72])]: items }, image: (url) => (url.includes('/abc/') ? res(200, { bytes: 'x', headers: { 'content-type': 'text/html' } }) : url.includes('/b/') ? res(302, { headers: { location: 'https://evil.test/p.jpg' } }) : picture()) });
  assert.equal(r.items, 3);
  assert.equal(r.failed, 2);
  assert.equal(r.thumbs, 1);
});

test('sync: three rate-limited pictures in a row stop the picture phase but keep the listing', async () => {
  const items = Array.from({ length: 5 }, (_, i) => raw({ id: String(10 + i), title: `T${i}`, url: `/pledge/Standalone-Ships/T${i}`, media: { thumbnail: { storeSmall: `https://media.robertsspaceindustries.com/${i}/s.jpg` } } }));
  const { r, saves } = await run({ listings: { [key([72])]: items }, image: () => res(429) });
  assert.equal(r.stopped, true);
  assert.equal(saves.at(-1).items.length, 5);
});

test('every category has a key, a label and product ids', () => {
  assert.equal(new Set(CATALOG_CATEGORIES.map((c) => c.key)).size, CATALOG_CATEGORIES.length);
  for (const c of CATALOG_CATEGORIES) assert.ok(c.label && c.products.every(Number.isInteger));
});

// ---- completeness (RSI's totalCount) ----
const rows = (n, from = 1) => Array.from({ length: n }, (_, i) => raw({ id: String(from + i), title: `S${from + i}`, url: `/pledge/Standalone-Ships/S${from + i}` }));

test('listing: pages follow totalCount even when a page is shorter than 100, and the figures are recorded per category', async () => {
  const seen = [];
  const post = async (body) => {
    const q = body.variables.query;
    if (q.skus.products[0] !== 72) return { data: { store: { listing: { resources: [], count: 0, totalCount: 0 } } } };
    seen.push(q.page);
    const all = rows(7);
    const slice = all.slice((q.page - 1) * 3, q.page * 3); // a server that caps a page at 3
    return { data: { store: { listing: { resources: slice, count: slice.length, totalCount: 7 } } } };
  };
  const out = await fetchItems({ post, sleep: async () => {}, interval: 1 });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(out.items.length, 7);
  assert.deepEqual(out.categories.ships, { expected: 7, got: 7 });
  assert.deepEqual(out.categories.paints, { expected: 0, got: 0 });
});

test('listing: a repeated entry is counted once, and a listing that delivers less than totalCount is reported', async () => {
  const post = async (body) => {
    const q = body.variables.query;
    if (q.skus.products[0] !== 72) return { data: { store: { listing: { resources: [], count: 0, totalCount: 0 } } } };
    const page = q.page === 1 ? rows(2) : q.page === 2 ? [rows(2)[1]] : [];
    return { data: { store: { listing: { resources: page, count: page.length, totalCount: 5 } } } };
  };
  const out = await fetchItems({ post, sleep: async () => {}, interval: 1 });
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.categories.ships, { expected: 5, got: 2 });
  assert.deepEqual(shortListings(out.categories), ['ships 2 of 5']);
});

test('fetchItems lists dropped entries with their reason and counts them all', async () => {
  const post = async (body) => {
    const q = body.variables.query;
    const list = q.skus.products[0] === 72 ? [raw({ id: '1' }), raw({ id: '2', nativePrice: { amount: null } }), raw({ id: '3', url: '/en/account/x' }), { title: 'no id' }] : [];
    return { data: { store: { listing: { resources: list, count: list.length, totalCount: list.length } } } };
  };
  const out = await fetchItems({ post, sleep: async () => {}, interval: 1 });
  assert.equal(out.items.length, 1);
  assert.equal(out.droppedCount, 3);
  assert.deepEqual(out.dropped.map((d) => [d.id, d.reason]), [[2, 'no price'], [3, 'no store page'], [null, 'no id']]);
});

test('sync: the file records signedIn, the per-category figures and the dropped count', async () => {
  const { r, saves } = await run({ images: false, signedIn: true, signedPost: async (body) => {
    const list = body.variables.query.skus.products[0] === 72 ? [raw({ id: '1', isVip: true }), raw({ id: '2', nativePrice: { amount: null } })] : [];
    return { data: { store: { listing: { resources: list, count: list.length, totalCount: list.length } } } };
  } });
  const doc = saves.at(-1);
  assert.equal(doc.signedIn, true);
  assert.deepEqual(doc.categories.ships, { expected: 2, got: 2 });
  assert.equal(doc.droppedCount, 1);
  assert.equal(r.signedIn, true);
  assert.equal(r.dropped, 1);
  // A session request answered with the public view (no Subscriber or Concierge item) is recorded as a public catalog, with a warning.
  const stale = await run({ images: false, signedIn: true, signedPost: async (body) => { const l = body.variables.query.skus.products[0] === 72 ? [raw({ id: '1' })] : []; return { data: { store: { listing: { resources: l, count: l.length, totalCount: l.length } } } }; } });
  assert.equal(stale.saves.at(-1).signedIn, false);
  assert.equal(stale.r.signedIn, false);
  assert.equal((await run({ images: false, listings: { [key([72])]: [raw()] } })).saves.at(-1).signedIn, false);
});

test('sync: the injected post is the only transport of a signed-in run (no fetch of a listing)', async () => {
  const { calls } = await run({ images: false, signedPost: async () => ({ data: { store: { listing: { resources: [raw()], count: 1, totalCount: 1 } } } }) });
  assert.equal(calls.filter((c) => c.init.method === 'POST').length, 0);
});

// ---- a good catalog is never replaced by a worse one ----
const item = (id, category = 'ships') => ({ id, category });
const many = (n, category = 'ships', from = 0) => Array.from({ length: n }, (_, i) => item(from + i, category));

test('assessCatalog: an empty, much smaller, category-less or public replacement is refused; a normal one passes', () => {
  assert.throws(() => assessCatalog(null, { items: [] }), /no store items/);
  assert.throws(() => assessCatalog({ items: many(100) }, { items: [] }), /no store items/);
  assert.throws(() => assessCatalog({ items: many(100) }, { items: many(60) }), /60 store items, the saved catalog has 100/);
  assert.throws(() => assessCatalog({ items: [...many(50), ...many(50, 'paints', 100)] }, { items: many(100, 'ships') }), /no paints/);
  assert.throws(() => assessCatalog({ signedIn: true, items: many(100) }, { signedIn: false, items: many(100) }), /signed-in sync/);
  assessCatalog(null, { items: many(3) });
  assessCatalog({ items: many(100) }, { items: many(75) });
  assessCatalog({ items: many(100) }, { signedIn: true, items: many(150) });
  assessCatalog({ signedIn: true, items: many(100) }, { signedIn: true, items: many(100) });
});

test('sync: a too small answer keeps the saved catalog (it throws before anything is saved)', async () => {
  const previous = { items: [...Array.from({ length: 50 }, (_, i) => ({ id: i + 1, category: 'ships', thumb: null }))] };
  const { error, saves } = await run({ previous, images: false, listings: { [key([72])]: rows(10) } });
  assert.match(error.message, /10 store items, the saved catalog has 50/);
  assert.equal(saves.length, 0);
});

test('sync: pictures no item uses any more are removed after a complete run, not after a stopped one', async () => {
  const items = [raw({ id: '1' })];
  const done = await run({ listings: { [key([72])]: items }, listImages: () => ['catalog/1.webp', 'catalog/99.webp'] });
  assert.deepEqual(done.removed, ['catalog/99.webp']);
  const many429 = Array.from({ length: 4 }, (_, i) => raw({ id: String(20 + i), title: `T${i}`, url: `/pledge/Standalone-Ships/T${i}`, media: { thumbnail: { storeSmall: `https://media.robertsspaceindustries.com/${i}/s.jpg` } } }));
  const stopped = await run({ listings: { [key([72])]: many429 }, image: () => res(429), listImages: () => ['catalog/99.webp'] });
  assert.deepEqual(stopped.removed, []);
});

test('assessCatalog: losing all Subscriber or all Concierge items, or a category by over 30 %, is refused', () => {
  const mk = (n, category, from, o = {}) => Array.from({ length: n }, (_, i) => ({ ...item(from + i, category), ...o }));
  const old = { signedIn: true, items: [...mk(60, 'ships', 0), ...mk(30, 'paints', 100), ...mk(4, 'gear', 200, { subscriber: true }), ...mk(4, 'gear', 300, { vip: true })] };
  // all Subscriber items gone, the total (95 of 100) still fine
  assert.throws(() => assessCatalog(old, { signedIn: true, items: [...mk(60, 'ships', 0), ...mk(30, 'paints', 100), ...mk(4, 'gear', 300, { vip: true })] }), /no Subscriber items/);
  // all Concierge items gone
  assert.throws(() => assessCatalog(old, { signedIn: true, items: [...mk(60, 'ships', 0), ...mk(30, 'paints', 100), ...mk(4, 'gear', 200, { subscriber: true })] }), /no Concierge items/);
  // a category over 30 % smaller, total still above 70 %: 60 ships -> 40
  assert.throws(() => assessCatalog(old, { signedIn: true, items: [...mk(40, 'ships', 0), ...mk(30, 'paints', 100), ...old.items.slice(90)] }), /40 ships items, the saved catalog has 60/);
  // exactly 30 % smaller and a small category (under 10 items) may change
  assessCatalog(old, { signedIn: true, items: [...mk(42, 'ships', 0), ...mk(30, 'paints', 100), ...old.items.slice(90)] });
  assessCatalog(old, { signedIn: true, items: [...mk(60, 'ships', 0), ...mk(30, 'paints', 100), ...mk(2, 'gear', 200, { subscriber: true }), ...mk(1, 'gear', 300, { vip: true })] });
  // a saved public catalog without such items is not held to the rule
  assessCatalog({ items: mk(60, 'ships', 0) }, { items: mk(60, 'ships', 0) });
});
