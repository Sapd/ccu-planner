// Reading RSI's store listings into catalog items, with every side effect injected (post, sleep, log, cancelled).
// No Node or browser API is used, so the Node sync (src/catalog-sync.mjs) and the desktop app's shared core (src/sync/core.mjs)
// run the same code. Read-only: the only request is the pinned browse query (src/sync/catalog-query.mjs); validateRequest
// checks every body before post() sends it, with or without the session's cookies (that is post's business).

import { CATALOG_CATEGORIES, classifyResource, mergeItem } from '../logic/store-catalog.mjs';
import { CATALOG_PATH, CATALOG_PAGE_SIZE, catalogBody } from './catalog-query.mjs';
import { validateRequest } from './policy.mjs';

const MAX_PAGES = 50;
const MAX_DROPPED_LISTED = 100;

/** One page of one listing: { resources, totalCount }. The body is checked against the allowlist before post() sends it. */
async function listingPage(products, page, tagFilter, post) {
  const body = catalogBody(products, page, tagFilter);
  validateRequest('POST', CATALOG_PATH, body);
  const json = await post(body);
  if (json?.errors?.length) throw new Error(`listing refused: ${String(json.errors[0]?.message ?? 'error').slice(0, 120)}`);
  const listing = json?.data?.store?.listing;
  if (!Array.isArray(listing?.resources)) throw new Error('listing has no resources');
  return { resources: listing.resources, totalCount: Number.isInteger(listing.totalCount) && listing.totalCount >= 0 ? listing.totalCount : null };
}

/**
 * Every resource of a listing, page after page until RSI's own totalCount is reached (a page that adds nothing new also ends it).
 * Resources are de-duplicated by id: equal sort weights can repeat an entry across pages.
 * @returns {Promise<{resources:object[], expected:number, got:number, duplicates:number}>} expected = RSI's totalCount, got = distinct entries received
 */
export async function listing(products, tagFilter, ctx) {
  const rows = [];
  const seen = new Set();
  let expected = null, duplicates = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (ctx.cancelled?.()) throw new Error('Sync cancelled; progress saved');
    const res = await listingPage(products, page, tagFilter, ctx.post);
    expected = res.totalCount ?? expected;
    let fresh = 0;
    for (const r of res.resources) {
      const id = Number(r?.id);
      if (Number.isSafeInteger(id) && id > 0) {
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
      }
      rows.push(r); fresh++;
    }
    if (!res.resources.length || !fresh) break;
    if (expected != null ? rows.length >= expected : res.resources.length < CATALOG_PAGE_SIZE) break;
    await ctx.sleep(ctx.interval);
  }
  return { resources: rows, expected: expected ?? rows.length, got: rows.length, duplicates };
}

/**
 * The catalog items of every listing, in RSI's order, each with its sub-categories, and what each listing promised and delivered.
 * Throws (so the caller keeps the old file) when a listing fails.
 * @param {{post:(body:object)=>Promise<object>, sleep:(ms:number)=>Promise<void>, interval:number, log?:(m:string)=>void, cancelled?:()=>boolean, progress?:(e:object)=>void}} ctx
 * @returns {Promise<{items:object[], categories:Record<string,{expected:number,got:number}>, dropped:object[], droppedCount:number}>}
 *   categories: per listing { expected: RSI's totalCount, got: entries received }, plus "<category>/<sub>" for the tag facets; dropped: entries without a usable id, title, page or price (at most 100 listed, droppedCount is the total)
 */
export async function fetchItems(ctx) {
  const log = ctx.log ?? (() => {});
  const byId = new Map();
  const categories = {};
  const dropped = [];
  let droppedCount = 0, calls = 0;
  const pace = async () => { if (calls++) await ctx.sleep(ctx.interval); };
  for (const group of CATALOG_CATEGORIES) {
    await pace();
    const found = await listing(group.products, null, ctx);
    categories[group.key] = { expected: found.expected, got: found.got };
    log(`catalog ${group.key}: ${found.got} of ${found.expected}${found.duplicates ? `, ${found.duplicates} repeated` : ''}`);
    for (const r of found.resources) {
      const c = classifyResource(r, group);
      if (!c.item) {
        droppedCount++;
        if (dropped.length < MAX_DROPPED_LISTED) dropped.push({ group: group.key, id: Number.isSafeInteger(Number(r?.id)) ? Number(r.id) : null, title: typeof r?.title === 'string' ? r.title.slice(0, 80) : null, reason: c.reason });
        continue;
      }
      byId.set(c.item.id, byId.has(c.item.id) ? mergeItem(byId.get(c.item.id), c.item) : c.item);
    }
    if (!group.facet || !found.got) continue;
    for (const sub of group.facet.subs) {
      await pace();
      const part = await listing(group.products, { facet: group.facet.id, tag: sub.tag }, ctx);
      categories[`${group.key}/${sub.key}`] = { expected: part.expected, got: part.got };
      log(`catalog ${group.key}/${sub.key}: ${part.got} of ${part.expected}`);
      for (const r of part.resources) {
        const it = byId.get(Number(r?.id));
        if (it && it.category === group.key && !it.subs.includes(sub.key)) { it.subs.push(sub.key); it.sub = it.subs[0]; }
      }
      ctx.progress?.({ phase: 'store catalog', done: calls, total: null });
    }
  }
  if (droppedCount) log(`catalog: ${droppedCount} entries dropped (${[...new Set(dropped.map((d) => d.reason))].join(', ')})`);
  return { items: [...byId.values()], categories, dropped, droppedCount };
}

/** The listings that delivered fewer entries than RSI's totalCount: ["ships 190 of 193", ...]. */
export const shortListings = (categories) => Object.entries(categories).filter(([key, v]) => !key.includes('/') && v.got < v.expected).map(([key, v]) => `${key} ${v.got} of ${v.expected}`);

const MAIN_CATEGORIES = ['ships', 'paints', 'gear'];
const MIN_CATEGORY_CHECK = 10;
const CATEGORY_KEYS = (items) => Object.fromEntries(items.map((i) => [i.category, true]));
const countBy = (items, key) => items.filter((i) => i.category === key).length;

/**
 * Throws when the new catalog must not replace the saved one: it is empty, much smaller (under 70 %), has a main category
 * (ships, paints, gear) that the old one had and it lacks, loses all Subscriber or all Concierge items, drops a category (10+ items) by over 30 %,
 * or it is a public catalog replacing a signed-in one.
 * @param {{items:object[], signedIn?:boolean}|null} previous the saved catalog; @param {{items:object[], signedIn?:boolean}} next the fresh one
 */
export function assessCatalog(previous, next) {
  if (!next.items.length) throw new Error('RSI returned no store items');
  if (!previous?.items?.length) return;
  if (previous.signedIn && !next.signedIn) throw new Error('The saved catalog is from a signed-in sync and a public one would drop its Subscriber and Concierge items. Sign in to RSI and refresh again');
  if (next.items.length < previous.items.length * 0.7) throw new Error(`RSI returned ${next.items.length} store items, the saved catalog has ${previous.items.length}`);
  for (const key of MAIN_CATEGORIES) if (countBy(previous.items, key) > 0 && countBy(next.items, key) === 0) throw new Error(`RSI returned no ${key} although the saved catalog has some`);
  // The account-only items: a refresh that loses all Subscriber (or all Concierge) items the saved one had is a degraded answer, even when the total looks fine.
  for (const [flag, label] of [['subscriber', 'Subscriber'], ['vip', 'Concierge']]) {
    if (previous.items.some((i) => i[flag]) && !next.items.some((i) => i[flag])) throw new Error(`RSI returned no ${label} items although the saved catalog has some`);
  }
  // Any category that lost more than 30 % of its items (small categories, under MIN_CATEGORY_CHECK items, are too noisy to judge).
  for (const key of Object.keys(CATEGORY_KEYS(previous.items))) {
    const before = countBy(previous.items, key), after = countBy(next.items, key);
    if (before >= MIN_CATEGORY_CHECK && after < before * 0.7) throw new Error(`RSI returned ${after} ${key} items, the saved catalog has ${before}`);
  }
}

/** The catalog file's content. */
export const catalogDoc = ({ items, categories, droppedCount, dropped }, { signedIn, now }) => ({ fetchedAt: now, signedIn: provesSignedIn(items, signedIn), categories, droppedCount, dropped, items });

/** A sync only counts as signed in when RSI's answer proves it: it contains Subscriber or Concierge items (a stale session gets the public view). */
export const provesSignedIn = (items, requested) => requested === true && items.some((i) => i.subscriber || i.vip);

/** The log line for a session request that RSI answered with the public catalog, else null. */
export const signedInWarning = (doc, requested) => (requested === true && !doc.signedIn ? 'warning: signed in, but RSI returned no Subscriber or Concierge items; the catalog is saved as a public one' : null);
