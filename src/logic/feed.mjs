// The signed data feed, the pure part: what the manifest may contain, how feed sale events merge with your own, and which
// store catalog the app shows. No I/O and no crypto here (src/feed.mjs checks signatures and hashes in Node, app/src-tauri/src/feed.rs
// in the desktop app); this file is also bundled into the webview.
//
// The feed is plain files at FEED_BASE (GitHub Pages), published hourly by .github/workflows/feed.yml:
//   manifest.json      { schema, generatedAt, files: { "<name>": { sha256, size } } }
//   manifest.json.sig  base64 ed25519 signature over the exact bytes of manifest.json
//   events.json        { schema, events: [{ id, name, from, to, note? }] }      sale events, hand-maintained in feed-src/events.json
//   store-catalog.json the public RSI store catalog (same document the catalog sync writes, signedIn false)
//   images/catalog/<id>.webp  the pictures of that catalog

import { isDay } from './availability.mjs';
import { readCatalog } from './store-catalog.mjs';

export const FEED_BASE = 'https://sapd.github.io/ccu-planner/feed/';
export const FEED_SCHEMA = 1;
/** The app asks again after this long (and on every start while the last check failed). */
export const FEED_REFRESH_MS = 6 * 60 * 60 * 1000;
export const FEED_MAX_FILES = 20000;
/** The only names a manifest may list (and so the only paths the clients ever request). */
export const FEED_FILE = /^(?:events\.json|store-catalog\.json|images\/catalog\/\d+\.webp)$/;
export const FEED_IMAGE = /^images\/catalog\/(\d+)\.webp$/;
export const FEED_MAX_BYTES = { json: 16 * 1024 * 1024, image: 4 * 1024 * 1024, manifest: 4 * 1024 * 1024 };
/** The sum of all file sizes a manifest may announce (the cache on a user's disk can never grow past this). */
export const FEED_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
/** A feed whose generatedAt is older than this is stale: the saved copy is still used, and the app says so. */
export const FEED_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** The tag merged events carry; a document with such events is never saved (see userSaleEvents). */
export const FEED_SOURCE = 'feed';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The manifest as a plain object, or throws: schema 1, a parseable generatedAt and only allowlisted names with a sha256 and a size.
 * @param {unknown} m the parsed manifest.json
 */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('manifest is not an object');
  if (m.schema !== FEED_SCHEMA) throw new Error(`unsupported feed schema ${JSON.stringify(m.schema)}`);
  if (typeof m.generatedAt !== 'string' || !Number.isFinite(Date.parse(m.generatedAt))) throw new Error('manifest has no valid generatedAt');
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) throw new Error('manifest has no file list');
  const names = Object.keys(m.files);
  if (names.length > FEED_MAX_FILES) throw new Error('manifest lists too many files');
  let total = 0;
  for (const name of names) {
    const f = m.files[name];
    if (!FEED_FILE.test(name)) throw new Error(`manifest lists a file that is not allowed: ${name}`);
    if (!f || typeof f.sha256 !== 'string' || !HEX64.test(f.sha256)) throw new Error(`bad sha256 for ${name}`);
    const cap = name.endsWith('.json') ? FEED_MAX_BYTES.json : FEED_MAX_BYTES.image;
    if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > cap) throw new Error(`bad size for ${name}`);
    total += f.size;
  }
  if (total > FEED_MAX_TOTAL_BYTES) throw new Error('manifest announces more data than allowed');
  return { schema: m.schema, generatedAt: m.generatedAt, files: Object.fromEntries(names.map((n) => [n, { sha256: m.files[n].sha256, size: m.files[n].size }])) };
}

/** True when a feed stamp (generatedAt) is older than FEED_STALE_MS at `now` (ms). An unreadable stamp is not called stale. */
export function feedIsStale(generatedAt, now = Date.now()) {
  const t = Date.parse(generatedAt ?? '');
  return Number.isFinite(t) && now - t > FEED_STALE_MS;
}

/**
 * Whether the bytes are a WebP picture of an allowed size: a RIFF container of exactly the stated length with the WEBP form type.
 * A cheap check of the container only; the feed build additionally lets the image library decode the header.
 */
export function isWebp(bytes) {
  if (!bytes || bytes.length < 20 || bytes.length > FEED_MAX_BYTES.image) return false;
  const tag = (at, text) => text.split('').every((c, i) => bytes[at + i] === c.charCodeAt(0));
  const riffSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] * 2 ** 24);
  return tag(0, 'RIFF') && tag(8, 'WEBP') && riffSize === bytes.length - 8;
}

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * The valid sale events of an events.json document, as { id, name, from, to, note }. `strict` throws on the first bad entry
 * (the feed build), otherwise bad entries are skipped (a client never fails on a document that passed its hash check).
 */
export function readEvents(doc, { strict = false } = {}) {
  const list = Array.isArray(doc?.events) ? doc.events : [];
  if (strict && !Array.isArray(doc?.events)) throw new Error('events document has no events list');
  const out = [];
  const ids = new Set();
  for (const [n, e] of list.entries()) {
    const name = cleanText(e?.name, 120);
    const problem = !name ? 'needs a name' : !isDay(e?.from) || !isDay(e?.to) ? 'needs from and to as YYYY-MM-DD' : e.from > e.to ? 'ends before it starts' : null;
    if (problem) { if (strict) throw new Error(`event ${n + 1} ${problem}`); continue; }
    const id = cleanText(e.id, 80) || `${e.from}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    if (ids.has(id)) { if (strict) throw new Error(`event ${n + 1} repeats the id ${id}`); continue; }
    ids.add(id);
    out.push({ id, name, from: e.from, to: e.to, note: cleanText(e.note, 300) });
  }
  if (out.length > 200) { if (strict) throw new Error('too many events'); out.length = 200; }
  return out;
}

const sameName = (a, b) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/**
 * Your own sale events plus the feed's. An event of yours wins over a feed event with the same name or the same dates (the feed one is dropped).
 * Feed events are tagged { source: 'feed', note } and get the id "feed:<id>"; yours stay as they are. The document keeps your rev,
 * so saving it would write the feed events into your file: use userSaleEvents() on anything that is saved.
 * @param {{ rev?: number, events?: object[] }|null} userDoc
 * @param {object[]} feedEvents readEvents() output
 * @param {string|null} feedAt the feed's generatedAt (part of the document so caches keyed on it notice a new feed)
 */
export function mergeSaleEvents(userDoc, feedEvents = [], feedAt = null) {
  const user = userSaleEvents(userDoc);
  const own = user.events;
  const fromFeed = feedEvents
    .filter((f) => !own.some((u) => sameName(u, f) || (u.from === f.from && u.to === f.to)))
    .map((f) => ({ id: `feed:${f.id}`, name: f.name, from: f.from, to: f.to, source: FEED_SOURCE, note: f.note ?? '' }));
  const doc = { ...user, events: [...own, ...fromFeed] };
  if (fromFeed.length || feedAt) doc.feedAt = feedAt ?? null;
  return doc;
}

/** The feed events of a merged document (the tagged ones), back in readEvents() shape. */
export const feedEventsOf = (doc) => (Array.isArray(doc?.events) ? doc.events : []).filter((e) => e?.source === FEED_SOURCE)
  .map((e) => ({ id: String(e.id).replace(/^feed:/, ''), name: e.name, from: e.from, to: e.to, note: e.note ?? '' }));

/** A sale-events document without the feed's events (and without the feed stamp): the part that belongs in sale-events.json. Idempotent. */
export function userSaleEvents(doc) {
  if (!doc) return { rev: 0, events: [] };
  const { feedAt, ...rest } = doc;
  return { ...rest, rev: doc.rev ?? 0, events: (Array.isArray(doc.events) ? doc.events : []).filter((e) => e?.source !== FEED_SOURCE) };
}

/** Where an event came from, for the Store's list: 'feed' or 'you'. */
export const eventSource = (ev) => (ev?.source === FEED_SOURCE ? 'feed' : 'you');

/** The first event of the feed that covers `today` (YYYY-MM-DD), or null. */
export const runningFeedEvent = (doc, today) => (Array.isArray(doc?.events) ? doc.events : []).find((e) => e?.source === FEED_SOURCE && e.from <= today && today <= e.to) ?? null;

// ----- the store catalog -----

/**
 * The feed's catalog document as the app reads it: only public (signedIn false), and a picture only where the feed's picture is on disk.
 * @param {unknown} doc store-catalog.json of the feed
 * @param {(name: string) => boolean} hasImage whether images/<name> (e.g. "catalog/12.webp") is in the local feed cache
 */
export function feedCatalog(doc, hasImage = () => false) {
  const c = readCatalog(doc);
  if (!c) return null;
  return { ...c, signedIn: false, items: c.items.map((i) => ({ ...i, thumb: i.thumb && hasImage(i.thumb) ? `feed/${i.thumb}` : null })) };
}

const time = (s) => { const t = Date.parse(s ?? ''); return Number.isFinite(t) ? t : null; };

/**
 * Which catalog the Browse store tab shows. Yours (the file the app's own sync wrote) when you are signed in at that sync (Subscriber and
 * Concierge items exist only there) or when it is the public kind and not older than the feed's; otherwise the feed's.
 * @returns {{ source: 'own'|'feed', doc: object }|null}
 */
export function chooseCatalog(own, feed) {
  const ownOk = own && Array.isArray(own.items) ? own : null;
  const feedOk = feed && Array.isArray(feed.items) && feed.items.length ? feed : null;
  if (!feedOk) return ownOk ? { source: 'own', doc: ownOk } : null;
  if (!ownOk) return { source: 'feed', doc: feedOk };
  if (ownOk.signedIn) return { source: 'own', doc: ownOk };
  const f = time(feedOk.fetchedAt), o = time(ownOk.fetchedAt);
  return f != null && (o == null || f > o) ? { source: 'feed', doc: feedOk } : { source: 'own', doc: ownOk };
}
