// The signed data feed, Node side (dev server, CLI, MCP, the feed build's own check). Mirrors app/src-tauri/src/feed.rs, which the desktop app uses.
//
// A refresh: GET manifest.json and manifest.json.sig from FEED_BASE, verify the ed25519 signature with the key embedded in
// src/feed-public-key.json (any failure: nothing changes, the last good copy stays), then fetch the files the manifest lists and
// check each against its sha256 before it is saved. The cache is <data dir>/feed/ and every file is written atomically; the manifest
// and its signature are written last, and a reader re-checks both, so a half-finished refresh is never used.
// Only GET requests to the feed address are made, with nothing in them but the path (no cookies, no ids, no query).
// Offline is normal: refreshFeed resolves to { status: 'offline' } and the app stays silent.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FEED_BASE, FEED_FILE, FEED_IMAGE, FEED_MAX_BYTES, FEED_REFRESH_MS, validateManifest, readEvents, feedIsStale } from './logic/feed.mjs';

const keyFile = JSON.parse(fs.readFileSync(new URL('./feed-public-key.json', import.meta.url), 'utf8'));
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
/** A public key object from the 32 raw bytes in base64 (the format of src/feed-public-key.json). */
export const publicKeyFrom = (base64) => {
  const raw = Buffer.from(base64, 'base64');
  if (raw.length !== 32) throw new Error('an ed25519 public key is 32 bytes');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
};
export const FEED_PUBLIC_KEY = publicKeyFrom(keyFile.publicKey);

// The oldest feed this build accepts (src/feed-floor.json, set by `npm run version`): a signed manifest older than the release that
// shipped it can only be a replay. Not a secret and not a constant of the feed; bumped with every release.
const floorFile = JSON.parse(fs.readFileSync(new URL('./feed-floor.json', import.meta.url), 'utf8'));
export const FEED_MIN_GENERATED_AT = floorFile.minGeneratedAt;
if (!Number.isFinite(Date.parse(FEED_MIN_GENERATED_AT))) throw new Error('src/feed-floor.json has no valid minGeneratedAt');

export class FeedError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; } // 'rejected': the feed said something we refuse; 'offline': we could not ask
}

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** The verified manifest, or throws FeedError('rejected'). The signature is over the exact bytes, so nothing is parsed before it is checked. */
export function verifyManifest(bytes, sigText, publicKey = FEED_PUBLIC_KEY) {
  if (bytes.length > FEED_MAX_BYTES.manifest) throw new FeedError('rejected', 'manifest is too large');
  const sig = Buffer.from(String(sigText).trim(), 'base64');
  if (sig.length !== 64) throw new FeedError('rejected', 'signature has the wrong length');
  let ok = false;
  try { ok = crypto.verify(null, bytes, publicKey, sig); } catch { ok = false; }
  if (!ok) throw new FeedError('rejected', 'signature does not match');
  try { return validateManifest(JSON.parse(bytes.toString('utf8'))); } catch (e) { throw new FeedError('rejected', e.message); }
}

/** Signs manifest bytes with a private key (PEM text or a KeyObject): base64 of the 64-byte signature. */
export const signManifest = (bytes, privateKey) => crypto.sign(null, bytes, typeof privateKey === 'string' ? crypto.createPrivateKey(privateKey) : privateKey).toString('base64');

// ----- the cache folder -----

export const feedDir = (dir) => path.join(dir, 'feed');
const imageName = (name) => FEED_IMAGE.test(name);

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
const readBytes = (file) => { try { return fs.readFileSync(file); } catch { return null; } };
const fileSize = (file) => { try { const st = fs.lstatSync(file); return st.isFile() ? st.size : -1; } catch { return -1; } };

/** The cached manifest if its signature still checks, else null. */
function cachedManifest(dir, publicKey) {
  const bytes = readBytes(path.join(feedDir(dir), 'manifest.json'));
  const sig = readBytes(path.join(feedDir(dir), 'manifest.json.sig'));
  if (!bytes || !sig) return null;
  try { return { manifest: verifyManifest(bytes, sig.toString('utf8'), publicKey), bytes }; } catch { return null; }
}

/** The bytes of a cached feed file when they match the manifest's sha256, else null. */
function cachedFile(dir, manifest, name) {
  const want = manifest.files[name];
  const bytes = want && readBytes(path.join(feedDir(dir), name));
  return bytes && bytes.length === want.size && sha256(bytes) === want.sha256 ? bytes : null;
}

/**
 * What the cache holds, in the shape the desktop's feed_read gives the webview: { generatedAt, eventsDoc, catalog, images }
 * (the two raw JSON documents, or null when missing or damaged; images: ["catalog/12.webp", "ships/7.webp", ...] present on disk), or null when there is
 * no verified manifest. The signature and the two JSON files' hashes are checked again on every read.
 */
export function readFeed(dir, { publicKey = FEED_PUBLIC_KEY } = {}) {
  const cached = cachedManifest(dir, publicKey);
  if (!cached) return null;
  const { manifest } = cached;
  const parse = (name) => { const b = cachedFile(dir, manifest, name); try { return b ? JSON.parse(b.toString('utf8')) : null; } catch { return null; } };
  const images = Object.keys(manifest.files).filter(imageName).filter((n) => fileSize(path.join(feedDir(dir), n)) === manifest.files[n].size).map((n) => n.slice('images/'.length));
  return { generatedAt: manifest.generatedAt, eventsDoc: parse('events.json'), catalog: parse('store-catalog.json'), images };
}

// The newest generatedAt ever accepted, kept next to (not inside) the feed folder: wiping or damaging <dir>/feed/ must not let an older
// signed manifest in. Not signed (a local file); it can only make this machine stricter.
const seenFile = (dir) => path.join(dir, 'feed-seen.json');
const readSeen = (dir) => { try { const v = JSON.parse(fs.readFileSync(seenFile(dir), 'utf8')).highestGeneratedAt; return Number.isFinite(Date.parse(v)) ? v : null; } catch { return null; } };
const stamp = (s) => (s == null ? -Infinity : Date.parse(s));
/** The oldest generatedAt a new manifest may carry: the embedded floor, the highest ever accepted here, the saved copy. */
const floorStamp = (dir, cached, minGeneratedAt) => Math.max(stamp(minGeneratedAt), stamp(readSeen(dir)), stamp(cached?.manifest.generatedAt));
const recordSeen = (dir, generatedAt) => { if (stamp(generatedAt) > stamp(readSeen(dir))) writeAtomic(seenFile(dir), JSON.stringify({ highestGeneratedAt: generatedAt })); };

// The app's version (app/package.json, kept equal to the desktop app's by scripts/version.mjs): a new version checks the feed at once.
export const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../app/package.json', import.meta.url), 'utf8')).version ?? null; } catch { return null; } })();
const readState = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(feedDir(dir), 'state.json'), 'utf8')); } catch { return {}; } };
const writeState = (dir, state) => writeAtomic(path.join(feedDir(dir), 'state.json'), JSON.stringify(state));

// ----- fetching -----

/** One GET of a feed file: a capped body, no redirects, a timeout. */
async function get(fetchFn, url, cap, timeoutMs) {
  let res;
  try { res = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: '*/*' } }); }
  catch (e) { throw new FeedError('offline', `could not reach the feed: ${e?.cause?.code ?? e?.message ?? e}`); }
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* already closed */ } throw new FeedError(res.status === 404 ? 'rejected' : 'offline', `feed answered HTTP ${res.status}`); }
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > cap) throw new FeedError('rejected', 'a feed file is larger than allowed');
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > cap) throw new FeedError('rejected', 'a feed file is larger than allowed');
      chunks.push(chunk);
    }
  } catch (e) { if (e instanceof FeedError) throw e; throw new FeedError('offline', 'the feed connection broke'); }
  return Buffer.concat(chunks);
}

/**
 * The feed address. The real one is a constant. CCU_FEED_URL (a folder served over http on this machine, for testing) counts only for the dev
 * server and the CLI's explicit --dev (`dev: true`) or under NODE_ENV=test; a normal run, the MCP server included, ignores it. Like the desktop
 * app, it must be the official address or http://localhost / 127.0.0.1 without credentials or query; anything else throws.
 */
export const feedBase = (env = process.env, { dev = false } = {}) => {
  const asked = env.CCU_FEED_URL;
  if (!asked || !(dev || env.NODE_ENV === 'test')) return FEED_BASE;
  const text = asked.endsWith('/') ? asked : `${asked}/`;
  let url;
  try { url = new URL(text); } catch { throw new Error('CCU_FEED_URL is not a valid address'); }
  const official = text === FEED_BASE;
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.username || url.password || url.search || url.hash || !(official || local)) throw new Error('CCU_FEED_URL must be the official feed or http://localhost');
  return text;
};

/**
 * Refreshes <dir>/feed/ from the feed. Never throws.
 * @param {object} o
 * @param {string} o.dir the data folder
 * @param {boolean} [o.force] ignore the 6 hour interval
 * @param {typeof fetch} [o.fetch]
 * @returns {Promise<{ status: 'updated'|'unchanged'|'skipped'|'offline'|'rejected', generatedAt: string|null, stale: boolean, error?: string }>}
 *   stale: the feed we now hold is older than 30 days (the publisher stopped); its data is still used
 */
export async function refreshFeed({ dir, force = false, fetch: fetchFn = fetch, base = feedBase(), publicKey = FEED_PUBLIC_KEY, now = () => Date.now(), timeoutMs = 20000, minGeneratedAt = FEED_MIN_GENERATED_AT, clock = Date.now, appVersion = APP_VERSION }) {
  const cached = cachedManifest(dir, publicKey);
  const staleAt = (at) => feedIsStale(at, clock());
  const state = readState(dir);
  const last = Number(state.checkedAt);
  if (!force && cached && state.app === appVersion && Number.isFinite(last) && now() - last < FEED_REFRESH_MS && now() >= last) return { status: 'skipped', generatedAt: cached.manifest.generatedAt, stale: staleAt(cached.manifest.generatedAt) };
  try {
    const bytes = await get(fetchFn, `${base}manifest.json`, FEED_MAX_BYTES.manifest, timeoutMs);
    const sig = await get(fetchFn, `${base}manifest.json.sig`, 1024, timeoutMs);
    const manifest = verifyManifest(bytes, sig.toString('utf8'), publicKey);
    // An older signed manifest replayed by whoever serves the files must not roll the cache back: not older than this build's floor, than the
    // highest one ever accepted on this machine (survives a wiped cache) or than the saved copy; the same stamp with other bytes is no update either.
    if (stamp(manifest.generatedAt) < floorStamp(dir, cached, minGeneratedAt)) throw new FeedError('rejected', 'the feed is older than the newest one accepted before');
    if (cached && cached.manifest.generatedAt === manifest.generatedAt && !cached.bytes.equals(bytes)) throw new FeedError('rejected', 'the feed has the same date as the saved copy but different content');
    // The two small files first: all downloaded and checked against the manifest before any replaces the saved one, so a refused file leaves the old copy whole.
    let changed = !cached || cached.manifest.generatedAt !== manifest.generatedAt || !cached.bytes.equals(bytes);
    const fresh = [];
    for (const name of ['events.json', 'store-catalog.json']) {
      if (!manifest.files[name] || cachedFile(dir, manifest, name)) continue;
      const body = await get(fetchFn, `${base}${name}`, FEED_MAX_BYTES.json, timeoutMs);
      if (body.length !== manifest.files[name].size || sha256(body) !== manifest.files[name].sha256) throw new FeedError('rejected', `${name} does not match the signed manifest`);
      fresh.push([name, body]);
    }
    for (const [name, body] of fresh) { writeAtomic(path.join(feedDir(dir), name), body); changed = true; }
    recordSeen(dir, manifest.generatedAt); // before the manifest, so a crash in between can only make this machine stricter
    writeAtomic(path.join(feedDir(dir), 'manifest.json'), bytes);
    writeAtomic(path.join(feedDir(dir), 'manifest.json.sig'), sig);
    writeState(dir, { checkedAt: now(), app: appVersion });
    return { status: changed ? 'updated' : 'unchanged', generatedAt: manifest.generatedAt, stale: staleAt(manifest.generatedAt) };
  } catch (e) {
    const kind = e instanceof FeedError ? e.kind : 'offline';
    return { status: kind, generatedAt: cached?.manifest.generatedAt ?? null, stale: staleAt(cached?.manifest.generatedAt), error: e.message };
  }
}

const SHIP_IMAGE = /^images\/ships\//;

/**
 * Downloads up to `limit` pictures the manifest lists and the cache lacks, ship pictures first (each checked against its sha256), then removes
 * saved pictures the manifest no longer lists once nothing is left to fetch. Never throws.
 * `scope`: 'all' (ship and catalog pictures) or 'ships' (ship pictures only: the app wants those whatever catalog it shows).
 * @returns {Promise<{ downloaded: number, remaining: number, failed: number }>}
 */
export async function fetchFeedImages({ dir, limit = 200, scope = 'all', fetch: fetchFn = fetch, base = feedBase(), publicKey = FEED_PUBLIC_KEY, timeoutMs = 20000, concurrency = 4 }) {
  const cached = cachedManifest(dir, publicKey);
  if (!cached) return { downloaded: 0, remaining: 0, failed: 0 };
  const { manifest } = cached;
  const missing = Object.keys(manifest.files).filter(imageName).filter((n) => scope !== 'ships' || SHIP_IMAGE.test(n))
    .filter((n) => fileSize(path.join(feedDir(dir), n)) !== manifest.files[n].size)
    .sort((a, b) => Number(SHIP_IMAGE.test(b)) - Number(SHIP_IMAGE.test(a)));
  const batch = missing.slice(0, limit);
  let downloaded = 0, failed = 0, offline = false;
  const queue = [...batch];
  const worker = async () => {
    while (queue.length && !offline) {
      const name = queue.shift();
      try {
        const body = await get(fetchFn, `${base}${name}`, FEED_MAX_BYTES.image, timeoutMs);
        if (body.length !== manifest.files[name].size || sha256(body) !== manifest.files[name].sha256) throw new FeedError('rejected', 'picture does not match the manifest');
        writeAtomic(path.join(feedDir(dir), name), body);
        downloaded++;
      } catch (e) { failed++; if (e.kind === 'offline') offline = true; }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const remaining = missing.length - downloaded;
  if (!remaining) {
    for (const kind of scope === 'ships' ? ['ships'] : ['ships', 'catalog']) {
      const folder = path.join(feedDir(dir), 'images', kind);
      try { for (const f of fs.readdirSync(folder)) if (!manifest.files[`images/${kind}/${f}`] && FEED_FILE.test(`images/${kind}/${f}`)) fs.rmSync(path.join(folder, f), { force: true }); } catch { /* no folder yet */ }
    }
  }
  return { downloaded, remaining, failed };
}

// ----- the planner's view of it -----

/** The feed's sale events and its stamp (verified cache only): { events: [], at: null } without a feed. */
export function loadFeedEvents(dir) {
  const feed = readFeed(dir);
  return feed ? { events: readEvents(feed.eventsDoc), at: feed.generatedAt } : { events: [], at: null };
}
