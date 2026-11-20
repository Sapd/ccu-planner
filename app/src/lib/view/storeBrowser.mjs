// The Store page's "Browse store" tab: the public RSI catalog as cards with a store switch, filters, search and sort. Pure.
// Items are the entries of store-catalog.json (src/logic/store-catalog.mjs). Prices are USD list prices in cents.
import { CATALOG_CATEGORIES, categoryLabel, subLabel } from '../../../../src/logic/store-catalog.mjs';
import { matchesQuery, searchText } from '../../../../src/logic/search.mjs';
import { norm } from '../../../../src/logic/ships.mjs';
import { whenText } from '../../../../src/logic/describe.mjs';
import { usd } from '../../../../src/logic/format.mjs';
import { selOf, emptySel } from './filters.mjs';
import { N_, loc } from '../../../../src/logic/i18n.mjs';

/** RSI has no separate Concierge store: Concierge-only items are flagged. Pledge store = everything that is neither subscriber-only nor Concierge-only. */
export const STORES = [
  { id: 'pledge', label: N_('Pledge store'), test: (i) => !i.subscriber && !i.vip },
  { id: 'subscriber', label: N_('Subscriber store'), test: (i) => i.subscriber },
  { id: 'concierge', label: N_('Concierge'), test: (i) => i.vip },
];
export const storeIds = STORES.map((s) => s.id);

/** The items of one store (the catalog order is RSI's relevance order and is kept). */
export const storeItems = (items, storeId) => { const s = STORES.find((x) => x.id === storeId) ?? STORES[0]; return items.filter(s.test); };
/** { pledge, subscriber, concierge }: how many items each store shows. */
export const storeCounts = (items) => Object.fromEntries(STORES.map((s) => [s.id, items.filter(s.test).length]));

/** The price a buyer pays now, in cents: the sale price when there is one. */
export const effectivePrice = (i) => i.saleCents ?? i.priceCents;
export const onSale = (i) => i.saleCents != null && i.saleCents < i.priceCents;
/** "−25%" (a true minus sign), or null when there is no sale. */
export const discountText = (i) => (onSale(i) && i.priceCents > 0 ? `−${Math.round((1 - i.saleCents / i.priceCents) * 100)}%` : null);
export const limitedStock = (i) => !i.stock?.unlimited && i.stock?.available !== false;

// ---- Which of the app's ships an offer is, only where the name says so exactly ----
// RSI's anniversary standalones carry one fixed edition suffix; the rule below drops that suffix and nothing else.
const matchName = (title) => norm(title).replace(/ 10 year$/, '');
/**
 * The planner ship an item is, or null. Only a ships item whose normalized title equals one ship's normalized name
 * (also without the " - 10 Year" edition suffix) and where exactly one ship has that name. Never a similar name.
 * @param {Map<number,{name:string}>} ships app.data.ships
 */
export function shipLinker(ships) {
  const byName = new Map();
  for (const [id, s] of ships) { const k = norm(s.name); byName.set(k, byName.has(k) ? null : id); }
  return (item) => (item.category === 'ships' ? byName.get(norm(item.title)) ?? byName.get(matchName(item.title)) ?? null : null);
}

/**
 * The items with their position (rank = RSI's order) and, for ships, the planner ship they are.
 * @param {Set<number>} owned ship ids in the hangar; @param {Set<number>} goals goal ship ids
 */
export function annotate(items, { ships = new Map(), owned = new Set(), goals = new Set() } = {}) {
  const link = shipLinker(ships);
  return items.map((i, rank) => {
    const shipId = link(i);
    return { ...i, rank, shipId, mine: shipId == null ? null : { owned: owned.has(shipId), goal: goals.has(shipId) } };
  });
}

// ---- Filters ----
const GEAR = CATALOG_CATEGORIES.find((c) => c.key === 'gear');
const PAINTS = CATALOG_CATEGORIES.find((c) => c.key === 'paints');
// An item can be in several tag facets (subs); one in none is "Other". The group restricts and counts only its own category's items.
const subsOf = (i) => (Array.isArray(i.subs) ? i.subs : []);
const subGroup = (cat, id, label) => ({ id, label, parent: cat.key, appliesTo: (i) => i.category === cat.key, options: cat.facet.subs.map((s) => ({ id: s.key, label: s.label, test: (i) => subsOf(i).includes(s.key) }))
  .concat([{ id: 'other', label: N_('Other'), test: (i) => !subsOf(i).length }]) });

/** Every group with every option: what the selection is built from (see selOf). */
export const BROWSE_GROUPS = [
  { id: 'category', label: N_('Category'), options: CATALOG_CATEGORIES.filter((c) => !c.subscriber).map((c) => ({ id: c.key, label: c.label, test: (i) => i.category === c.key })).concat([{ id: 'other', label: N_('Other'), test: (i) => i.category === 'other' }]) },
  subGroup(GEAR, 'gear', N_('Gear type')),
  subGroup(PAINTS, 'paints', N_('Paint type')),
  { id: 'offer', label: N_('Offer'), options: [
    { id: 'sale', label: N_('On sale'), test: onSale },
    { id: 'warbond', label: N_('Warbond'), test: (i) => i.warbond },
    { id: 'limited', label: N_('Limited time'), test: (i) => i.limited },
    { id: 'stock', label: N_('Limited stock'), test: limitedStock },
  ] },
  { id: 'price', label: N_('Price'), kind: 'range', value: effectivePrice },
  { id: 'mine', label: N_('Your ships'), options: [
    { id: 'owned', label: N_('In my hangar'), test: (i) => i.mine?.owned === true },
    { id: 'goal', label: N_('Goal ship'), test: (i) => i.mine?.goal === true },
  ] },
];
export const emptyBrowseSel = () => emptySel(BROWSE_GROUPS);
export const browseSelOf = (stored) => selOf(stored, BROWSE_GROUPS);

/**
 * The groups to show for the items of one store: only categories that have items here, a gear / paint type group only while
 * that category is ticked, and the "Your ships" group only when at least one item is a ship in the hangar or a goal.
 */
export function visibleGroups(storeItemsList, sel) {
  const has = new Set(storeItemsList.map((i) => i.category));
  const linked = storeItemsList.some((i) => i.mine?.owned || i.mine?.goal);
  return BROWSE_GROUPS.flatMap((g) => {
    if (g.id === 'category') return [{ ...g, options: g.options.filter((o) => has.has(o.id) || (sel.category ?? []).includes(o.id)) }];
    if (g.parent) return (sel.category ?? []).includes(g.parent) && has.has(g.parent) ? [g] : [];
    if (g.id === 'mine') return linked ? [g] : [];
    return [g];
  });
}

// ---- Search and sort ----
export const SORTS = [
  { id: 'relevance', label: N_('Relevance') },
  { id: 'price-asc', label: N_('Price, low to high') },
  { id: 'price-desc', label: N_('Price, high to low') },
  { id: 'name', label: N_('Name') },
];
export const sortId = (v) => (SORTS.some((s) => s.id === v) ? v : 'relevance');

const itemText = (i) => searchText(i.title, i.tags, categoryLabel(i.category), subsOf(i).map((s) => subLabel(i.category, s)));
export const searchItems = (items, query) => items.filter((i) => matchesQuery(itemText(i), query));

/** The items in the chosen order; ties keep RSI's order. In RSI's order itself, items that can be bought come before sold-out ones (the first screen is not full of them). */
export function sortItems(items, id) {
  const by = {
    'price-asc': (a, b) => effectivePrice(a) - effectivePrice(b),
    'price-desc': (a, b) => effectivePrice(b) - effectivePrice(a),
    name: (a, b) => a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }),
  }[sortId(id)];
  return by ? [...items].sort((a, b) => by(a, b) || a.rank - b.rank) : [...items].sort((a, b) => (a.stock?.available === false) - (b.stock?.available === false) || a.rank - b.rank);
}

// ---- Cards ----
/** The tags on a card, at most two, never the one the open store already says. */
export function cardTags(i, storeId) {
  const all = [];
  if (i.vip && storeId !== 'concierge') all.push(N_('Concierge'));
  if (i.subscriber && storeId !== 'subscriber') all.push(N_('Subscriber'));
  if (i.warbond) all.push(N_('Warbond'));
  if (i.limited) all.push(N_('Limited time'));
  return all.slice(0, 2);
}

/** What one card shows. */
export function cardView(i, storeId) {
  return {
    id: i.id, title: i.title, url: i.url, thumb: i.thumb ?? null, tags: cardTags(i, storeId),
    price: usd(effectivePrice(i)), was: onSale(i) ? usd(i.priceCents) : null, off: discountText(i), soldOut: i.stock?.available === false,
  };
}

/** "Store catalog from today, 14:05 · signed in", "Public store catalog from today, 14:05", "Catalog from the CCU Planner feed, today, 14:05" (source 'feed'), or "No store catalog yet". (The header's "Store: ..." stamp is the upgrade data.) */
export const catalogAge = loc('storeBrowser.catalogAge', (fetchedAt, signedIn, now = new Date(), source = 'own') => { const w = whenText(fetchedAt, now); if (w && source === 'feed') return `Catalog from the CCU Planner feed, ${w}`; return w ? (signedIn ? `Store catalog from ${w} · signed in` : `Public store catalog from ${w}`) : 'No store catalog yet'; });

/** Why a store has nothing to show, when that is because of how the catalog was fetched (a public catalog never has Subscriber or Concierge items), else null. */
export function emptyStoreReason(storeId, signedIn) {
  if (signedIn) return null;
  if (storeId === 'subscriber') return N_('Sync while signed in to see the Subscriber store. RSI shows it only to a signed-in account.');
  if (storeId === 'concierge') return N_('Sync while signed in to see Concierge items. RSI shows them only to a signed-in account.');
  return null;
}

/** What the tab remembers while the app runs. */
export const freshBrowse = () => ({ store: 'pledge', query: '', sort: 'relevance', sel: null });
