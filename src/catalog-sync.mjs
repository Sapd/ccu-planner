// The store catalog sync (Node host) with every side effect injected (fetch, sleep, clock, save), so it runs in tests without a network.
// Used by scripts/sync-catalog.mjs. Read-only: POST /graphql with the pinned browse query (src/sync/catalog-query.mjs, checked by
// validateRequest before every request). Anonymous by default (no cookies, same host, spaced requests, back-off on 429); a signed-in
// run passes its own `post` (the RsiClient's) and the same reading code (src/sync/catalog-fetch.mjs) runs on it. Pictures are always anonymous.

import { rsiThumbUrl, RSI_ORIGIN, thumbName } from './logic/store-catalog.mjs';
import { CATALOG_PATH } from './sync/catalog-query.mjs';
import { fetchItems, assessCatalog, catalogDoc, signedInWarning, shortListings } from './sync/catalog-fetch.mjs';
import { fetchOk, readCapped, RateLimited, STOP_AFTER_RATE_LIMITED, MAX_IMAGE_BYTES, MAX_LISTING_BYTES } from './image-sync.mjs';

const IMAGE_TYPE = /^image\/(jpeg|png|webp|avif|gif)\s*(;|$)/i;

/** The anonymous POST: no cookies, no redirect, a capped JSON body. The caller (fetchItems) has already checked the body against the allowlist. */
export const anonymousPost = ({ fetch, sleep, interval, log }) => async (body) => {
  const res = await fetchOk(`${RSI_ORIGIN}${CATALOG_PATH}`, 'application/json', { fetch, sleep, interval, log, allow: () => false }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { return JSON.parse((await readCapped(res, MAX_LISTING_BYTES, 'listing')).toString('utf8')); }
  catch (e) { throw /too large/.test(e.message) ? e : new Error('listing is not JSON'); }
};

/** The picture bytes: content-type one of the common image types, at most MAX_IMAGE_BYTES (read with a running cap), on RSI's hosts only. */
async function fetchImage(url, ctx) {
  const res = await fetchOk(url, 'image/*', { ...ctx, allow: (u) => rsiThumbUrl(u) === u }, {});
  if (!IMAGE_TYPE.test(res.headers?.get?.('content-type') ?? '')) throw new Error('not an image');
  return readCapped(res, MAX_IMAGE_BYTES, 'image');
}

export { thumbName };

/**
 * @param {object} o
 * @param {{items:object[], signedIn?:boolean}|null} o.previous the catalog on disk (pictures it already has are kept)
 * @param {(body:object)=>Promise<object>} [o.post] sends one listing request and resolves to the parsed JSON; default: the anonymous one
 * @param {boolean} [o.signedIn] whether `post` carries the user's session (written to the file, shown by the app)
 * @param {(catalog:object)=>void} o.save called after the listing and while the pictures come in
 * @param {(buf:Buffer)=>Promise<Buffer>} o.resize one picture as WebP
 * @param {(name:string, bytes:Buffer)=>void|Promise<void>} o.writeImage writes images/<name> atomically
 * @param {(name:string)=>boolean} o.exists whether images/<name> exists
 * @param {()=>string[]} [o.listImages] the names in images/catalog/ (as catalog/<file>); with removeImage, pictures no item uses are deleted after a complete run
 * @param {(name:string)=>void} [o.removeImage]
 * @returns {Promise<{items:number, thumbs:number, fetched:number, failed:number, stopped:boolean, signedIn:boolean, dropped:number, short:string[], removed:number, counts:object}>}
 */
export async function syncCatalog({ previous = null, post = null, signedIn = false, fetch, sleep, resize, writeImage, exists = () => true, listImages = null, removeImage = null, now = () => new Date().toISOString(), save = () => {}, cancelled = () => false, interval = 1000, imageInterval = 300, images = true, progress = () => {}, log = () => {} }) {
  const ctx = { sleep, interval, log, cancelled, progress, post: post ?? anonymousPost({ fetch, sleep, interval, log }) };
  const found = await fetchItems(ctx);
  const items = found.items;
  const doc = catalogDoc(found, { signedIn, now: now() });
  const warn = signedInWarning(doc, signedIn);
  if (warn) log(warn);
  assessCatalog(previous, doc); // throws: the saved catalog stays
  const short = shortListings(found.categories);
  if (short.length) log(`warning: RSI delivered fewer entries than it announced: ${short.join(', ')}`);
  const old = new Map((previous?.items ?? []).map((i) => [i.id, i]));
  for (const it of items) {
    const p = old.get(it.id);
    it.thumb = p?.thumb && p.thumbUrl && p.thumbUrl === it.thumbUrl && p.thumb === thumbName(it.id) && exists(p.thumb) ? p.thumb : null;
  }
  save(doc);
  const todo = images ? items.filter((i) => i.thumbUrl && !i.thumb) : [];
  let fetched = 0, failed = 0, limited = 0, stopped = false;
  const cache = new Map(); // one download per picture address: items sharing a picture share the bytes
  const hasThumbs = () => items.filter((i) => i.thumb).length;
  for (const [n, it] of todo.entries()) {
    if (cancelled()) break;
    try {
      let bytes = cache.get(it.thumbUrl);
      if (!bytes) {
        const raw = await fetchImage(it.thumbUrl, { fetch, sleep, interval: imageInterval, log, cancelled });
        fetched++;
        try { bytes = await resize(raw); } catch (e) { throw new Error(`resize failed: ${e.message}`); }
        if (!bytes?.length) throw new Error('resize failed: empty output');
        cache.set(it.thumbUrl, bytes);
        if (n < todo.length - 1) await sleep(imageInterval);
      }
      await writeImage(thumbName(it.id), bytes);
      it.thumb = thumbName(it.id);
      limited = 0;
    } catch (e) {
      if (cancelled()) break;
      failed++;
      limited = e instanceof RateLimited ? limited + 1 : 0;
      log(`  picture ${it.id} ${it.title}: ${e.message}`);
      if (limited >= STOP_AFTER_RATE_LIMITED) { log('RSI is rate-limiting; stopped, run again later'); stopped = true; break; }
    }
    if ((n + 1) % 25 === 0) { save(doc); progress({ phase: 'store catalog pictures', done: n + 1, total: todo.length }); }
  }
  save(doc);
  // Pictures of items that left the catalog are deleted, but only after a complete run (a stopped or cancelled one may not know every item's picture yet).
  let removed = 0;
  if (listImages && removeImage && !stopped && !cancelled()) {
    const used = new Set(items.map((i) => i.thumb).filter(Boolean));
    for (const name of listImages()) if (!used.has(name)) { removeImage(name); removed++; }
  }
  const counts = { ...found.categories };
  return { items: items.length, thumbs: hasThumbs(), fetched, failed, stopped, signedIn: doc.signedIn, dropped: found.droppedCount, short, removed, counts,
    subscriber: items.filter((i) => i.subscriber).length, concierge: items.filter((i) => i.vip).length };
}
