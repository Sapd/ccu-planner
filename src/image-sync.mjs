// The ship-image sync loop with every side effect injected (fetch, sleep, clock,
// save), so it can be tested without a network. Used by scripts/sync-images.mjs.

import { parseOgImage, shipImageUrl } from './logic/images.mjs';

const ORIGIN = 'https://robertsspaceindustries.com';
export const REQUEST_TIMEOUT_MS = 15000;
export const MAX_429_TRIES = 5;
export const MAX_REDIRECTS = 5;
export const STOP_AFTER_RATE_LIMITED = 3;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export class RateLimited extends Error {}

/**
 * One request with a timeout, back-off on 429 and redirects followed by hand (a GET only, and only where ctx.allow lets it: the
 * RSI web host by default). Resolves to the final ok response. init: { method, body, headers } (a POST never follows a redirect).
 */
export async function fetchOk(url, accept, { fetch, sleep, interval, log, allow = (u) => new URL(u).origin === ORIGIN }, init = {}) {
  const method = init.method ?? 'GET';
  let redirects = 0;
  for (let attempt = 0; attempt < MAX_429_TRIES; ) {
    const res = await fetch(url, { method, body: init.body, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { 'user-agent': 'Mozilla/5.0 (compatible; ccu-planner)', ...init.headers, accept } });
    if (res.status === 429) {
      attempt++;
      if (attempt >= MAX_429_TRIES) throw new RateLimited('HTTP 429');
      const wait = Math.max((Number(res.headers?.get?.('retry-after')) || 0) * 1000, 5000 * 2 ** (attempt - 1));
      log(`  429, waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 300 && res.status < 400) {
      if (method !== 'GET') throw new Error('unexpected redirect');
      if (++redirects > MAX_REDIRECTS) throw new Error('too many redirects');
      let next;
      try { next = new URL(res.headers?.get?.('location') ?? '', url); } catch { throw new Error('bad redirect'); }
      if (!allow(next.href)) throw new Error('redirect off host');
      url = next.href;
      await sleep(interval);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  throw new RateLimited('HTTP 429');
}

const fetchPage = async (url, ctx) => (await fetchOk(url, 'text/html', ctx)).text();

/** The most a store listing response may be (the desktop app's Rust side uses the same 20 MB). */
export const MAX_LISTING_BYTES = 20 * 1024 * 1024;

/** A response body as a Buffer, at most `max` bytes (checked while a streaming body is read), else throws `${what} too large`. */
export async function readCapped(res, max, what = 'body') {
  const declared = Number(res.headers?.get?.('content-length'));
  if (declared > max) throw new Error(`${what} too large`);
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new Error(`${what} too large`);
    return buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); throw new Error(`${what} too large`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The image bytes: content-type must be image/*, the body at most MAX_IMAGE_BYTES. */
async function fetchImage(url, ctx) {
  const res = await fetchOk(url, 'image/*', ctx);
  if (!/^image\//i.test(res.headers?.get?.('content-type') ?? '')) throw new Error('not an image');
  return readCapped(res, MAX_IMAGE_BYTES, 'image');
}

const thumbNames = (id) => ({ s: `${id}-s.webp`, l: `${id}-l.webp` });

/** Does this ship need a page fetch (no url yet), an image download (no matching local files), or neither? */
export function shipWork(store, ship, { refresh = false, exists = () => true } = {}) {
  const e = store.images?.[ship.id];
  const page = refresh || !e?.url;
  const t = e?.thumbs;
  const names = thumbNames(ship.id);
  const image = refresh || !e?.url || !t || t.sourceUrl !== e.url || t.s !== names.s || t.l !== names.l || !exists(t.s) || !exists(t.l);
  return { page, image };
}

/**
 * @param {object} o
 * @param {{id:number,name:string,page:string|null}[]} o.ships
 * @param {{images:object}} o.store mutated in place
 * @param {(store:object)=>void} o.save called after every entry
 * @param {(buf:Buffer)=>Promise<{s:Buffer,l:Buffer}>} o.resize the two WebP sizes of one picture
 * @param {(name:string, bytes:Buffer)=>void|Promise<void>} o.writeImage writes images/<name> atomically
 * @param {(name:string)=>boolean} o.exists whether images/<name> exists
 * @returns {Promise<{ok:number,failed:number,fetched:number,stopped:boolean}>}
 */
export async function syncImages({ ships, store, fetch, sleep, resize, writeImage, exists = () => true, now = () => new Date().toISOString(), save = () => {}, cancelled = () => false, limit = null, refresh = false, interval = 1000, log = () => {} }) {
  store.images ??= {};
  let todo = ships.filter((s) => { const w = shipWork(store, s, { refresh, exists }); return w.page || w.image; });
  if (limit != null) todo = todo.slice(0, limit);
  let ok = 0, failed = 0, fetched = 0, limited = 0, stopped = false;
  const ctx = { fetch, sleep, interval, log };
  for (const [i, s] of todo.entries()) {
    if (cancelled()) break;
    const at = now();
    fetched++;
    let rateLimited = false;
    let result;
    try {
      const work = shipWork(store, s, { refresh, exists });
      let url = store.images[s.id]?.url ?? null;
      if (work.page) {
        if (!s.page) throw new Error('no usable link');
        const found = parseOgImage(await fetchPage(s.page, ctx));
        if (!found) throw new Error('no og:image');
        url = found;
        const old = store.images[s.id];
        // Local files stay valid while the source url is unchanged.
        store.images[s.id] = { url, page: s.page, fetchedAt: at, ...(old?.thumbs && old.thumbs.sourceUrl === url ? { thumbs: old.thumbs } : {}) };
        await sleep(interval);
      }
      if (work.image) {
        // A stored url is data from disk: check the host before the first request.
        if (!shipImageUrl(url)) throw new Error('image url not on the RSI host');
        const bytes = await fetchImage(url, ctx);
        let out;
        try { out = await resize(bytes); } catch (e) { throw new Error(`resize failed: ${e.message}`); }
        if (!out?.s?.length || !out?.l?.length) throw new Error('resize failed: empty output');
        const names = thumbNames(s.id);
        await writeImage(names.l, out.l);
        await writeImage(names.s, out.s);
        const { error, errorAt, ...entry } = store.images[s.id];
        store.images[s.id] = { ...entry, thumbs: { s: names.s, l: names.l, sourceUrl: url, bytes: out.s.length + out.l.length } };
      }
      ok++;
      result = `${url}${work.image ? ` (${store.images[s.id].thumbs.bytes} bytes)` : ''}`;
    } catch (e) {
      if (cancelled()) break;
      rateLimited = e instanceof RateLimited;
      const old = store.images[s.id];
      // A failed refresh keeps the good url (and thumbs) and only notes the error.
      store.images[s.id] = old?.url ? { ...old, error: e.message, errorAt: at } : { url: null, page: s.page, fetchedAt: at, error: e.message };
      failed++;
      result = `FAILED ${e.message}`;
    }
    store.fetchedAt = at;
    save(store);
    log(`images ${i + 1}/${todo.length}: ${s.name} -> ${result}`);
    limited = rateLimited ? limited + 1 : 0;
    if (limited >= STOP_AFTER_RATE_LIMITED) { log('RSI is rate-limiting; stopped, run again later'); stopped = true; break; }
    if (i < todo.length - 1) await sleep(interval);
  }
  return { ok, failed, fetched, stopped };
}
