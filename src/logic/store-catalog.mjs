// The public RSI store catalog: categories, parsing of one store listing entry, and the image address rules. Pure.
// Written by src/catalog-sync.mjs as <data dir>/store-catalog.json, read by the Browse store tab.
// Prices are USD list prices in cents (nativePrice, never the session currency).

export const RSI_ORIGIN = 'https://robertsspaceindustries.com';

/**
 * RSI's own product-id groups of the store. facet: the tag facet RSI offers for the group (its sub-categories).
 * Goodies, UEC and event tickets are empty today and are kept so they appear when RSI fills them.
 * There is no public Concierge store and no ship weapons category on RSI: Concierge items are flagged isVip, weapons are Add-ons and Gear.
 */
export const CATALOG_CATEGORIES = [
  { key: 'ships', label: 'Ships and vehicles', products: [72] },
  { key: 'packs', label: 'Packs', products: [270] },
  { key: 'packages', label: 'Game packages', products: [9, 45, 46] },
  { key: 'paints', label: 'Paints', products: [268], facet: { id: 'paints', subs: [
    { key: 'limited-time', label: 'Limited time', tag: 'filters-paint-limited-time' },
    { key: 'premium', label: 'Premium', tag: 'filters-paint-premium' },
    { key: 'standard', label: 'Standard', tag: 'filters-paint-standard' },
  ] } },
  { key: 'gear', label: 'Gear', products: [289], facet: { id: 'extras-gear', subs: [
    { key: 'armor', label: 'Armor', tag: 'filters-gear-armor' },
    { key: 'clothing', label: 'Clothing', tag: 'filters-gear-clothing' },
    { key: 'equipment', label: 'Equipment', tag: 'filters-gear-equipment' },
  ] } },
  { key: 'addons', label: 'Add-ons', products: [3] },
  { key: 'goodies', label: 'Digital goodies', products: [222] },
  { key: 'uec', label: 'UEC', products: [41] },
  { key: 'tickets', label: 'Event tickets', products: [67] },
  { key: 'giftcards', label: 'Gift cards', products: [60] },
  // Subscriber-only purchases: the item's own kind comes from its store path (see categoryFromUrl).
  { key: 'subscriber', label: 'Subscriber store', products: [65], subscriber: true },
];

/** Display label of a category key ("Other" for a kind outside the list). */
export const categoryLabel = (key) => CATALOG_CATEGORIES.find((c) => c.key === key)?.label ?? 'Other';
/** Display label of a sub-category key within a category. */
export const subLabel = (category, sub) => CATALOG_CATEGORIES.find((c) => c.key === category)?.facet?.subs.find((s) => s.key === sub)?.label ?? sub;

const URL_KIND = { 'standalone-ships': 'ships', packages: 'packages', packs: 'packs', paints: 'paints', gear: 'gear', 'add-ons': 'addons', 'gift-cards': 'giftcards' };
/** The category named by the first path segment of a store url (/pledge/Gear/...), or 'other'. */
export function categoryFromUrl(path) {
  const m = /^\/pledge\/([^/]+)\//.exec(String(path ?? ''));
  return (m && URL_KIND[m[1].toLowerCase()]) || 'other';
}

/** A https address on one of RSI's hosts, without userinfo or port, else null. A path resolves against the main host. */
function address(value, hosts) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let u;
  try { u = new URL(value.trim(), `${RSI_ORIGIN}/`); } catch { return null; }
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname) || u.username || u.password || u.port) return null;
  return u;
}
/** The store page of an item: https://robertsspaceindustries.com/pledge/... only, no query and no fragment (never an account or API page). */
export function rsiPageUrl(value) {
  const u = address(value, ['robertsspaceindustries.com']);
  return u && /^\/pledge\/[^?#]+$/.test(u.pathname) && !u.search && !u.hash ? u.href : null;
}
/** The picture of an item: any path on media.robertsspaceindustries.com, or /i/ and /media/ on the main host (what the desktop app also allows). */
export function rsiThumbUrl(value) {
  const u = address(value, ['robertsspaceindustries.com', 'media.robertsspaceindustries.com']);
  if (!u || u.hash) return null;
  return u.hostname === 'media.robertsspaceindustries.com' || /^\/(i|media)\//.test(u.pathname) ? u.href : null;
}

const cents = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * One catalog item from a store listing entry: { item } or, when it has no usable id, title, page or price, { reason }.
 * @param {object} r a resources[] entry of GetBrowseSkusByFilter
 * @param {{key:string, subscriber?:boolean}} group the product group it was listed under
 */
export function classifyResource(r, group) {
  const id = Number(r?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { reason: 'no id' };
  const title = text(r?.title) || text(r?.name);
  if (!title) return { reason: 'no title' };
  const url = rsiPageUrl(r?.url);
  if (!url) return { reason: 'no store page' };
  const price = cents(r?.nativePrice?.amount);
  if (price == null) return { reason: 'no price' };
  const discounted = cents(r.nativePrice.discounted);
  const tags = (Array.isArray(r.tags) ? r.tags : []).map((t) => text(t?.name)).filter(Boolean);
  const subscriber = group.subscriber === true;
  return { item: {
    id,
    title,
    category: subscriber ? categoryFromUrl(new URL(url).pathname) : group.key,
    sub: null,
    subs: [],
    url,
    thumbUrl: rsiThumbUrl(r?.media?.thumbnail?.storeSmall),
    thumb: null,
    priceCents: price,
    saleCents: discounted != null && discounted < price ? discounted : null,
    warbond: r.isWarbond === true,
    limited: tags.some((t) => /^limited time$/i.test(t)),
    vip: r.isVip === true,
    subscriber,
    package: r.isPackage === true,
    stock: { unlimited: r.stock?.unlimited === true, available: r.stock?.available !== false, qty: Number.isInteger(r.stock?.qty) ? r.stock.qty : null },
    tags,
  } };
}
/** The catalog item of a listing entry, or null (see classifyResource for why). */
export const parseResource = (r, group) => classifyResource(r, group).item ?? null;

/** Merges a second listing of the same item (it can be in a subscriber group and a normal one): the flags add up, the first entry's kind stays. */
export function mergeItem(a, b) {
  const subs = [...new Set([...(a.subs ?? []), ...(b.subs ?? [])])];
  return { ...a, subscriber: a.subscriber || b.subscriber, vip: a.vip || b.vip, limited: a.limited || b.limited, thumbUrl: a.thumbUrl ?? b.thumbUrl, subs, sub: subs[0] ?? null };
}

/** The local picture name of an item (images/<name>): catalog/<id>.<ext>, the extension of the saved format. */
export const THUMB_FILE = /^catalog\/(\d+)\.(webp|png|jpg|jpeg|avif|gif)$/;
export const thumbName = (id, ext = 'webp') => `catalog/${id}.${ext}`;
const thumbOk = (i) => i.thumb == null || (typeof i.thumb === 'string' && THUMB_FILE.exec(i.thumb)?.[1] === String(i.id));

/** The per-category completeness of a sync: { key: { expected, got } } with only plain numbers kept. */
const readCategories = (c) => (c && typeof c === 'object' && !Array.isArray(c)
  ? Object.fromEntries(Object.entries(c).filter(([, v]) => Number.isInteger(v?.expected) && Number.isInteger(v?.got)).map(([k, v]) => [k, { expected: v.expected, got: v.got }]))
  : {});

/**
 * A catalog file as the app uses it: only items with the shape the app relies on, with tags, stock and subs coerced
 * (a hand-edited or older file never breaks the page). signedIn is true only when the file says so.
 */
export function readCatalog(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) return null;
  const items = doc.items.filter((i) => i && Number.isSafeInteger(i.id) && typeof i.title === 'string' && i.title && typeof i.category === 'string'
    && typeof i.url === 'string' && rsiPageUrl(i.url) === i.url && Number.isInteger(i.priceCents)
    && (i.saleCents == null || Number.isInteger(i.saleCents)) && thumbOk(i))
    .map((i) => {
      const subs = (Array.isArray(i.subs) ? i.subs : typeof i.sub === 'string' ? [i.sub] : []).filter((s) => typeof s === 'string');
      return { ...i, tags: (Array.isArray(i.tags) ? i.tags : []).filter((t) => typeof t === 'string'), subs, sub: subs[0] ?? null,
        stock: i.stock && typeof i.stock === 'object' ? i.stock : {}, thumbUrl: typeof i.thumbUrl === 'string' ? i.thumbUrl : null };
    });
  return { fetchedAt: typeof doc.fetchedAt === 'string' ? doc.fetchedAt : null, signedIn: doc.signedIn === true, categories: readCategories(doc.categories),
    droppedCount: Number.isInteger(doc.droppedCount) ? doc.droppedCount : 0, items };
}
