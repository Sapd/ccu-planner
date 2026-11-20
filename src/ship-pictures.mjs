// The ship pictures of the data feed (CI side), with every side effect injected (fetch, sleep, clock, files), so it runs in tests without a network.
// Used by scripts/build-feed.mjs. Read-only and anonymous, RSI's own hosts only:
//   1. the ship list: POST of the pinned initShipUpgrade query to the upgrade-tool endpoint (it answers without a session);
//   2. per ship that has no picture yet, its public store page (og:image), then that picture;
//   3. each picture is resized to one WebP of at most 640 px (resize is injected) and handed to writeImage as ships/<id>.webp.
// Only new ships are fetched; a few ships' pages are looked at again on every run (the least recently checked first), so a changed picture is
// noticed within days without hammering RSI. A ship whose page or picture failed is left alone for a day. Pages are fetched one second apart.
// A failing RSI never fails the caller: the pictures already in the cache stay, and the caller publishes those.

import { parseOgImage, shipImageUrl, shipPageUrl } from './logic/images.mjs';
import { QUERIES } from './sync/queries.mjs';
import { validateRequest } from './sync/policy.mjs';
import { fetchOk, readCapped, RateLimited, STOP_AFTER_RATE_LIMITED, MAX_IMAGE_BYTES, MAX_LISTING_BYTES } from './image-sync.mjs';

const ORIGIN = 'https://robertsspaceindustries.com';
export const UPGRADE_PATH = '/pledge-store/api/upgrade/v2/graphql';
/** The widest a published ship picture is (the cache check in src/feed-cache.mjs holds files to the same limit). */
export const SHIP_PICTURE_MAX = 640;
export const SHIP_PICTURE_QUALITY = 75;
/** How many already-known ships have their page looked at again per run, and how long a failed ship is left alone. */
export const RECHECK_PER_RUN = 5;
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
/** A listing with fewer ships than this is not believed (RSI has about 250). */
export const MIN_SHIPS = 20;
/** Cached pictures of ships missing from the listing are dropped only when the listing has at least this share of the ships known before. */
export const PLAUSIBLE_LISTING = 0.8;
/** The notes (checked/failed dates) are saved to the cache at least this often, though no picture changed (see sourcesNeedSave). */
export const DATES_SAVE_MS = 20 * 60 * 60 * 1000;

const stampMs = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : -Infinity; };

/** The newest checkedAt/failedAt in a ship-sources document (ms), or -Infinity. */
export const newestNote = (sources) => Object.values(sources?.ships ?? {}).reduce((m, e) => Math.max(m, stampMs(e?.checkedAt), stampMs(e?.failedAt)), -Infinity);

/**
 * Whether the working notes are worth saving to the CI cache: a picture address was added, changed or dropped, or the dates the cache holds
 * are older than DATES_SAVE_MS (so the "least recently checked" rotation and the failure back-off persist, about once a day).
 */
export function sourcesNeedSave(persisted, current, nowMs) {
  const key = (d) => JSON.stringify(Object.entries(d?.ships ?? {}).map(([id, e]) => [id, e.url ?? null]));
  const newest = newestNote(persisted); // a date in the future (a damaged cache) counts as stale too
  return key(persisted) !== key(current) || !(nowMs - newest >= 0 && nowMs - newest <= DATES_SAVE_MS);
}

const IMAGE_TYPE = /^image\/(jpeg|png|webp|avif|gif)\s*(;|$)/i;
const same = (u) => new URL(u).origin === ORIGIN;

/** The cache name of a ship's picture. */
export const shipPictureName = (id) => `ships/${id}.webp`;

/** One anonymous POST of the pinned upgrade-tool query; resolves to the parsed JSON. */
async function postListing(ctx) {
  const body = [{ operationName: 'initShipUpgrade', variables: {}, query: QUERIES.initShipUpgrade }];
  validateRequest('POST', UPGRADE_PATH, body);
  const res = await fetchOk(`${ORIGIN}${UPGRADE_PATH}`, 'application/json', { ...ctx, allow: () => false }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { return JSON.parse((await readCapped(res, MAX_LISTING_BYTES, 'listing')).toString('utf8')); }
  catch (e) { throw /too large/.test(e.message) ? e : new Error('listing is not JSON'); }
}

/** The ships of the listing as { id, name, page }, or throws when the answer is not a believable list. */
export async function fetchShipList(ctx) {
  const data = await postListing(ctx);
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || first.errors?.length) throw new Error('the ship list has errors');
  const list = first.data?.ships;
  if (!Array.isArray(list) || list.length < MIN_SHIPS) throw new Error('the ship list is too short');
  const seen = new Set();
  const ships = [];
  for (const s of list) {
    if (!Number.isSafeInteger(s?.id) || s.id <= 0 || seen.has(s.id)) continue;
    seen.add(s.id);
    ships.push({ id: s.id, name: typeof s.name === 'string' ? s.name : String(s.id), page: shipPageUrl(s.link) });
  }
  if (ships.length < MIN_SHIPS) throw new Error('the ship list is too short');
  return ships;
}

async function fetchPicture(url, ctx) {
  const res = await fetchOk(url, 'image/*', { ...ctx, allow: same }, {});
  if (!IMAGE_TYPE.test(res.headers?.get?.('content-type') ?? '')) throw new Error('not an image');
  return readCapped(res, MAX_IMAGE_BYTES, 'image');
}

/**
 * @param {object} o
 * @param {{ ships?: Record<string, { page: string, url: string, checkedAt?: string, failedAt?: string, error?: string }> }|null} o.previous
 *   what the cache remembers about each ship's picture source (src/feed-cache.mjs validates it before it gets here)
 * @param {(buf:Buffer)=>Promise<Buffer>} o.resize one picture as WebP (at most SHIP_PICTURE_MAX wide)
 * @param {(name:string, bytes:Buffer)=>void|Promise<void>} o.writeImage writes images/<name> atomically
 * @param {(name:string)=>boolean} o.exists whether images/<name> exists
 * @param {()=>string[]} o.listImages the names in images/ships/ (as ships/<file>)
 * @param {(name:string)=>void} o.removeImage
 * @param {(sources:object)=>void} o.save called with the source notes after every ship
 * @returns {Promise<{ ids:number[], ships:number, fetched:number, failed:number, removed:number, stopped:boolean, sources:object }>}
 *   ids: the ships that have a picture in the cache now (what the feed publishes)
 */
export async function syncShipPictures({ previous = null, fetch, sleep, resize, writeImage, exists = () => true, listImages = () => [], removeImage = () => {}, now = () => new Date().toISOString(), save = () => {}, cancelled = () => false, interval = 1000, imageInterval = 300, recheck = RECHECK_PER_RUN, log = () => {} }) {
  const ctx = { fetch, sleep, interval, log };
  const ships = await fetchShipList(ctx);
  await sleep(interval); // the listing is a request too: a second before the first page
  const sources = { ships: { ...(previous?.ships ?? {}) } };
  const at = now();
  const nowMs = Date.parse(at);
  const has = (s) => exists(shipPictureName(s.id)) && sources.ships[s.id]?.url;
  // A failure date in the future (a damaged cache) never holds a ship back.
  const waiting = (s) => { const f = Date.parse(sources.ships[s.id]?.failedAt ?? ''); return Number.isFinite(f) && f <= nowMs && nowMs - f < RETRY_AFTER_MS; };
  const fresh = ships.filter((s) => s.page && !has(s) && !waiting(s));
  const known = ships.filter((s) => s.page && has(s) && !waiting(s))
    .sort((a, b) => String(sources.ships[a.id].checkedAt ?? '').localeCompare(String(sources.ships[b.id].checkedAt ?? '')))
    .slice(0, recheck);
  const todo = [...fresh, ...known];
  let fetched = 0, failed = 0, limited = 0, stopped = false, downloaded = 0;
  for (const [n, s] of todo.entries()) {
    if (cancelled()) break;
    const old = sources.ships[s.id];
    let rateLimited = false;
    try {
      const url = parseOgImage(await (await fetchOk(s.page, 'text/html', { ...ctx, allow: same })).text());
      if (!url) throw new Error('no og:image');
      await sleep(interval);
      if (old?.url === url && exists(shipPictureName(s.id))) {
        sources.ships[s.id] = { page: s.page, url, checkedAt: at };
      } else {
        if (!shipImageUrl(url)) throw new Error('image url not on the RSI host');
        const raw = await fetchPicture(url, { ...ctx, interval: imageInterval });
        let out;
        try { out = await resize(raw); } catch (e) { throw new Error(`resize failed: ${e.message}`); }
        if (!out?.length) throw new Error('resize failed: empty output');
        await writeImage(shipPictureName(s.id), out);
        sources.ships[s.id] = { page: s.page, url, checkedAt: at };
        downloaded++;
      }
      fetched++;
      log(`ship pictures ${n + 1}/${todo.length}: ${s.name} ok`);
    } catch (e) {
      if (cancelled()) break;
      rateLimited = e instanceof RateLimited;
      failed++;
      // A failed ship keeps its good picture (and url); a rate limit is nobody's fault, so it is not noted against the ship.
      if (!rateLimited) sources.ships[s.id] = { ...(old ?? { page: s.page, url: null }), failedAt: at, error: String(e.message).slice(0, 200) };
      log(`ship pictures ${n + 1}/${todo.length}: ${s.name} FAILED ${e.message}`);
    }
    save(sources);
    limited = rateLimited ? limited + 1 : 0;
    if (limited >= STOP_AFTER_RATE_LIMITED) { log('RSI is rate-limiting; stopped, the rest follows next run'); stopped = true; break; }
    if (n < todo.length - 1) await sleep(interval);
  }
  // Pictures and notes of ships RSI no longer lists go away, but only when the listing is a plausible full one: a short answer (a proxy, a partial
  // page) must never empty the cache. Otherwise the cached pictures stay and are published as they are.
  const listed = new Set(ships.map((s) => s.id));
  const cachedIds = new Set(listImages().map((n) => /^ships\/(\d+)\.webp$/.exec(n)?.[1]).filter(Boolean).map(Number));
  const everKnown = new Set([...Object.keys(previous?.ships ?? {}).map(Number), ...cachedIds]);
  const plausible = everKnown.size === 0 || listed.size >= PLAUSIBLE_LISTING * everKnown.size;
  let removed = 0;
  if (plausible) {
    for (const id of cachedIds) if (!listed.has(id)) { removeImage(shipPictureName(id)); removed++; }
    for (const id of Object.keys(sources.ships)) if (!listed.has(Number(id))) delete sources.ships[id];
  } else log(`ship list has ${listed.size} of ${everKnown.size} known ships: keeping the cached pictures of the others`);
  save(sources);
  const ids = [...new Set([...ships.map((s) => s.id), ...(plausible ? [] : cachedIds)])].filter((id) => exists(shipPictureName(id)));
  return { ids, ships: ships.length, fetched, failed, downloaded, removed, stopped, sources };
}
