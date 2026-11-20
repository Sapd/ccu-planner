import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStoreReason, STORES, storeItems, storeCounts, annotate, shipLinker, visibleGroups, BROWSE_GROUPS, emptyBrowseSel, browseSelOf, searchItems, sortItems, cardView, cardTags, effectivePrice, discountText, catalogAge, sortId } from '../../app/src/lib/view/storeBrowser.mjs';
import { applyFilters, optionCounts, toggleOption, setRange, activeFilters, resetAll } from '../../app/src/lib/view/filters.mjs';

let n = 0;
const item = (o = {}) => ({ id: ++n, title: `Item ${n}`, category: 'ships', sub: null, subs: [], url: `https://robertsspaceindustries.com/pledge/x/${n}`, thumbUrl: null, thumb: null, priceCents: 10000, saleCents: null, warbond: false, limited: false, vip: false, subscriber: false, package: false, stock: { unlimited: true, available: true, qty: 0 }, tags: [], ...o });
const catalog = () => annotate([
  item({ title: 'Avenger Titan', category: 'ships', priceCents: 7500 }),
  item({ title: 'Gladius', category: 'ships', priceCents: 9000, saleCents: 6750, warbond: true }),
  item({ title: 'Pioneer - 10 Year', category: 'ships', priceCents: 80000, limited: true, stock: { unlimited: false, available: true, qty: 3 } }),
  item({ title: 'Mining Career Kit', category: 'gear', subs: ['equipment'], priceCents: 1000 }),
  item({ title: 'Geist Armor', category: 'gear', subs: ['armor'], priceCents: 2500 }),
  item({ title: 'Emerald Paint', category: 'paints', subs: ['premium'], priceCents: 1500 }),
  item({ title: 'Industrial Pack', category: 'packs', vip: true, priceCents: 200000 }),
  item({ title: 'Sub Hat', category: 'gear', subs: ['clothing'], subscriber: true, priceCents: 500 }),
  item({ title: 'Both', category: 'addons', subscriber: true, vip: true, priceCents: 700 }),
], { ships: new Map([[1, { name: 'Gladius' }], [2, { name: 'Pioneer' }], [3, { name: 'Avenger Titan' }], [4, { name: 'Twin' }], [5, { name: 'Twin' }]]), owned: new Set([1]), goals: new Set([2]) });

test('the three stores: pledge is neither subscriber-only nor Concierge-only; an item can be in both of the others', () => {
  const c = catalog();
  assert.deepEqual(storeItems(c, 'pledge').map((i) => i.title), ['Avenger Titan', 'Gladius', 'Pioneer - 10 Year', 'Mining Career Kit', 'Geist Armor', 'Emerald Paint']);
  assert.deepEqual(storeItems(c, 'subscriber').map((i) => i.title), ['Sub Hat', 'Both']);
  assert.deepEqual(storeItems(c, 'concierge').map((i) => i.title), ['Industrial Pack', 'Both']);
  assert.deepEqual(storeCounts(c), { pledge: 6, subscriber: 2, concierge: 2 });
  assert.deepEqual(storeItems(c, 'nonsense'), storeItems(c, 'pledge'));
  assert.deepEqual(STORES.map((s) => s.id), ['pledge', 'subscriber', 'concierge']);
});

test('ship links: exact normalized name, or the exact name plus the 10 Year edition suffix; never similar or ambiguous', () => {
  const link = shipLinker(new Map([[1, { name: 'Gladius' }], [2, { name: 'F7C-R Hornet Mk II - Tracker' }], [4, { name: 'Twin' }], [5, { name: 'Twin' }], [6, { name: 'Carrack' }]]));
  const s = (title, category = 'ships') => link({ title, category });
  assert.equal(s('Gladius'), 1);
  assert.equal(s('gladius'), 1);
  assert.equal(s('Gladius - 10 Year'), 1);
  assert.equal(s('F7C-R Hornet Mk II - Tracker - 10 Year'), 2);
  assert.equal(s('Gladius Dunlevy'), null);
  assert.equal(s('Carrack Expedition'), null);
  assert.equal(s('Twin'), null);
  assert.equal(s('Gladius', 'paints'), null);
  assert.equal(s('Gladius - 20 Year'), null);
});

test('annotate keeps RSI order as rank and marks ships in the hangar and goal ships', () => {
  const c = catalog();
  assert.deepEqual(c.map((i) => i.rank), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(c.find((i) => i.title === 'Gladius').mine, { owned: true, goal: false });
  assert.deepEqual(c.find((i) => i.title === 'Pioneer - 10 Year').mine, { owned: false, goal: true });
  assert.equal(c.find((i) => i.title === 'Geist Armor').mine, null);
});

test('category and offer filters', () => {
  const c = storeItems(catalog(), 'pledge');
  const groups = visibleGroups(c, emptyBrowseSel());
  let sel = toggleOption(emptyBrowseSel(), 'category', 'gear');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title), ['Mining Career Kit', 'Geist Armor']);
  sel = toggleOption(sel, 'category', 'paints');
  assert.equal(applyFilters(c, BROWSE_GROUPS, sel).length, 3);
  sel = toggleOption(emptyBrowseSel(), 'offer', 'sale');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title), ['Gladius']);
  sel = toggleOption(toggleOption(emptyBrowseSel(), 'offer', 'warbond'), 'offer', 'limited');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title), ['Gladius', 'Pioneer - 10 Year']);
  sel = toggleOption(emptyBrowseSel(), 'offer', 'stock');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title), ['Pioneer - 10 Year']);
  assert.ok(groups.length);
});

test('gear and paint types narrow only their own category', () => {
  const c = storeItems(catalog(), 'pledge');
  let sel = toggleOption(toggleOption(emptyBrowseSel(), 'category', 'gear'), 'gear', 'armor');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title), ['Geist Armor']);
  sel = toggleOption(sel, 'category', 'ships');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title), ['Avenger Titan', 'Gladius', 'Pioneer - 10 Year', 'Geist Armor']);
});

test('the price range uses the sale price', () => {
  const c = storeItems(catalog(), 'pledge');
  let sel = setRange(setRange(emptyBrowseSel(), 'price', 'min', '60'), 'price', 'max', '80');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title), ['Avenger Titan', 'Gladius']);
  assert.deepEqual(activeFilters(BROWSE_GROUPS, sel).map((a) => a.label), ['Price $60 to $80']);
  assert.equal(applyFilters(c, BROWSE_GROUPS, resetAll(BROWSE_GROUPS)).length, c.length);
});

test('your ships filter: in my hangar and goal ship, only where a link exists', () => {
  const c = storeItems(catalog(), 'pledge');
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, toggleOption(emptyBrowseSel(), 'mine', 'owned')).map((i) => i.title), ['Gladius']);
  assert.deepEqual(applyFilters(c, BROWSE_GROUPS, toggleOption(emptyBrowseSel(), 'mine', 'goal')).map((i) => i.title), ['Pioneer - 10 Year']);
  assert.ok(visibleGroups(c, emptyBrowseSel()).some((g) => g.id === 'mine'));
  const none = annotate([item({ title: 'Unknown Ship' })], { ships: new Map([[1, { name: 'Gladius' }]]) });
  assert.ok(!visibleGroups(none, emptyBrowseSel()).some((g) => g.id === 'mine'));
});

test('visible groups: only categories with items; type groups only while their category is ticked', () => {
  const c = storeItems(catalog(), 'pledge');
  const ids = (sel) => visibleGroups(c, sel).map((g) => g.id);
  assert.deepEqual(ids(emptyBrowseSel()), ['category', 'offer', 'price', 'mine']);
  assert.deepEqual(visibleGroups(c, emptyBrowseSel())[0].options.map((o) => o.id), ['ships', 'paints', 'gear']);
  assert.deepEqual(ids(toggleOption(emptyBrowseSel(), 'category', 'gear')), ['category', 'gear', 'offer', 'price', 'mine']);
  assert.deepEqual(ids(toggleOption(toggleOption(emptyBrowseSel(), 'category', 'gear'), 'category', 'paints')), ['category', 'gear', 'paints', 'offer', 'price', 'mine']);
  // a ticked category that is not in this store stays visible so it can be unticked
  assert.ok(visibleGroups(storeItems(catalog(), 'subscriber'), toggleOption(emptyBrowseSel(), 'category', 'ships'))[0].options.some((o) => o.id === 'ships'));
});

test('option counts follow the other filters', () => {
  const c = storeItems(catalog(), 'pledge');
  const counts = optionCounts(c, BROWSE_GROUPS, toggleOption(emptyBrowseSel(), 'offer', 'sale'));
  assert.equal(counts.category.ships, 1);
  assert.equal(counts.category.gear, 0);
  assert.equal(optionCounts(c, BROWSE_GROUPS, emptyBrowseSel()).category.ships, 3);
});

test('a stored selection that does not fit is replaced', () => {
  assert.deepEqual(browseSelOf(null), emptyBrowseSel());
  assert.deepEqual(browseSelOf({ category: ['ships', 'gone'], offer: 'x', price: { min: 5 } }).category, ['ships']);
  assert.deepEqual(browseSelOf({ category: ['ships'] }).price, { min: '', max: '' });
});

test('search matches title, tags and category words; every word must match', () => {
  const c = catalog();
  assert.deepEqual(searchItems(c, 'glad').map((i) => i.title), ['Gladius']);
  assert.deepEqual(searchItems(c, 'paint emerald').map((i) => i.title), ['Emerald Paint']);
  assert.deepEqual(searchItems(c, 'armor').map((i) => i.title), ['Geist Armor']);
  assert.equal(searchItems(c, '').length, c.length);
  assert.equal(searchItems(c, 'zzz').length, 0);
});

test('sort: relevance is RSI order, price uses the sale price, name is alphabetical, ties keep RSI order', () => {
  const c = storeItems(catalog(), 'pledge');
  assert.deepEqual(sortItems(c, 'relevance').map((i) => i.rank), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(sortItems(c, 'price-asc').map((i) => i.title), ['Mining Career Kit', 'Emerald Paint', 'Geist Armor', 'Gladius', 'Avenger Titan', 'Pioneer - 10 Year']);
  assert.deepEqual(sortItems(c, 'price-desc').map((i) => i.title).slice(0, 2), ['Pioneer - 10 Year', 'Avenger Titan']);
  assert.deepEqual(sortItems(c, 'name').map((i) => i.title), ['Avenger Titan', 'Emerald Paint', 'Geist Armor', 'Gladius', 'Mining Career Kit', 'Pioneer - 10 Year']);
  assert.deepEqual(sortItems([...c].reverse(), 'bogus').map((i) => i.rank), [0, 1, 2, 3, 4, 5]);
  assert.equal(sortId('x'), 'relevance');
});

test('cards: sale price with the old one and the percentage; two tags at most; the open store is never repeated', () => {
  const sale = item({ priceCents: 6000, saleCents: 4500, warbond: true, limited: true, vip: true, subscriber: true });
  const v = cardView(sale, 'pledge');
  assert.equal(v.price, '$45');
  assert.equal(v.was, '$60');
  assert.equal(v.off, '\u221225%');
  assert.deepEqual(v.tags, ['Concierge', 'Subscriber']);
  assert.deepEqual(cardTags(sale, 'concierge'), ['Subscriber', 'Warbond']);
  assert.deepEqual(cardTags(sale, 'subscriber'), ['Concierge', 'Warbond']);
  const plain = cardView(item({ priceCents: 1250 }), 'pledge');
  assert.equal(plain.price, '$12.50');
  assert.equal(plain.was, null);
  assert.equal(plain.off, null);
  assert.deepEqual(plain.tags, []);
  assert.equal(cardView(item({ stock: { unlimited: false, available: false, qty: null } }), 'pledge').soldOut, true);
  assert.equal(discountText(item({ priceCents: 100, saleCents: 100 })), null);
  assert.equal(effectivePrice(sale), 4500);
});

test('cards link only to RSI and carry the local picture name', () => {
  const v = cardView(item({ thumb: 'catalog/5.webp' }), 'pledge');
  assert.ok(v.url.startsWith('https://robertsspaceindustries.com/'));
  assert.equal(v.thumb, 'catalog/5.webp');
});

test('the catalog age line', () => {
  const now = new Date('2026-11-20T15:00:00');
  assert.match(catalogAge('2026-11-20T14:05:00', true, now), /^Store catalog from today, \d\d:\d\d · signed in$/);
  assert.match(catalogAge('2026-11-20T14:05:00', false, now), /^Public store catalog from today, \d\d:\d\d$/);
  assert.equal(catalogAge(null, false, now), 'No store catalog yet');
});

test('an item in two tag facets shows under both; one in none is "Other"; the type group counts only its own category', () => {
  const c = annotate([
    item({ title: 'Both', category: 'gear', subs: ['armor', 'equipment'] }),
    item({ title: 'Armor only', category: 'gear', subs: ['armor'] }),
    item({ title: 'Untagged', category: 'gear', subs: [] }),
    item({ title: 'A ship', category: 'ships' }),
  ]);
  const base = toggleOption(emptyBrowseSel(), 'category', 'gear');
  const titles = (sel) => applyFilters(c, BROWSE_GROUPS, sel).map((i) => i.title);
  assert.deepEqual(titles(toggleOption(base, 'gear', 'armor')), ['Both', 'Armor only']);
  assert.deepEqual(titles(toggleOption(base, 'gear', 'equipment')), ['Both']);
  assert.deepEqual(titles(toggleOption(base, 'gear', 'other')), ['Untagged']);
  assert.deepEqual(optionCounts(c, BROWSE_GROUPS, toggleOption(emptyBrowseSel(), 'category', 'gear')).gear, { armor: 2, clothing: 0, equipment: 1, other: 1 });
  assert.equal(searchItems(c, 'equipment').length, 1);
});

test('relevance puts items that can be bought before sold-out ones; the other sorts keep their order', () => {
  const c = annotate([item({ title: 'Sold', stock: { unlimited: false, available: false } }), item({ title: 'Ok A' }), item({ title: 'Sold 2', stock: { available: false } }), item({ title: 'Ok B' })]);
  assert.deepEqual(sortItems(c, 'relevance').map((i) => i.title), ['Ok A', 'Ok B', 'Sold', 'Sold 2']);
  assert.deepEqual(sortItems(c, 'name').map((i) => i.title), ['Ok A', 'Ok B', 'Sold', 'Sold 2']);
});

test('"Your ships" shows only when an item is in the hangar or a goal', () => {
  const none = annotate([item({ title: 'Gladius' })], { ships: new Map([[1, { name: 'Gladius' }]]) });
  assert.ok(!visibleGroups(none, emptyBrowseSel()).some((g) => g.id === 'mine'));
  const some = annotate([item({ title: 'Gladius' })], { ships: new Map([[1, { name: 'Gladius' }]]), owned: new Set([1]) });
  assert.ok(visibleGroups(some, emptyBrowseSel()).some((g) => g.id === 'mine'));
});

test('an empty Subscriber or Concierge store says why, but only for a public catalog', () => {
  assert.match(emptyStoreReason('subscriber', false), /^Sync while signed in to see the Subscriber store/);
  assert.match(emptyStoreReason('concierge', false), /^Sync while signed in to see Concierge items/);
  assert.equal(emptyStoreReason('subscriber', true), null);
  assert.equal(emptyStoreReason('pledge', false), null);
});
