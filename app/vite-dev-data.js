// Dev-only Vite plugin: the same four operations as the Tauri commands in
// src-tauri/src/lib.rs, over HTTP, on the directory named by CCU_DATA.
import fs from 'node:fs';
import { createSyncRunner } from './dev-sync.js';
import os from 'node:os';
import path from 'node:path';
import { readRaw } from '../src/data.mjs';
import { withWriteLock } from '../src/sync/write-lock.mjs';
import { readFeed, refreshFeed, fetchFeedImages, feedBase } from '../src/feed.mjs';

const LEGACY_FILES = ['catalog.json', 'ship-details.json', 'hangar.json', 'buyback.json', 'plans.json', 'price-overrides.json', 'ship-images.json', 'offer-history.jsonl', 'sale-history.json', 'sale-events.json', 'warbond-prices.json', 'plan-snapshots.json'];
const IMAGE_FILE = /^(?:\d+-(s|l)\.webp|\d+-original\.(webp|png|jpe?g|avif|gif)|catalog\/\d+\.(webp|png|jpe?g|avif|gif)|feed\/(?:catalog|ships)\/\d+\.webp)$/;
const DOCS = { plans: 'plans.json', overrides: 'price-overrides.json', 'sale-events': 'sale-events.json' };
// plan-snapshots.json is not a revisioned document and never in DOCS: scripts/sync.mjs, the MCP sync and the desktop app's own sync (through sync_write) write it; the app only reads it through readRaw.
// Documents the user edits in the app: an import never replaces an existing one.
const KEEP_ON_IMPORT = new Set(['plans.json', 'price-overrides.json', 'sale-events.json']);

const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

function writeAtomic(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, target);
}

function upgradeFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && isFile(path.join(dir, f))).sort();
}

/** Ship picture file names (regular files only) in an images folder. */
function imageFiles(dir) {
  try { if (!fs.lstatSync(dir).isDirectory()) return []; } catch { return []; }
  return fs.readdirSync(dir).filter((f) => IMAGE_FILE.test(f) && isFile(path.join(dir, f))).sort();
}

/** The bytes of images/<name>, or null for any name that is not <id>-s|l.webp or is not a regular file. */
export function readImage(dir, name) {
  if (typeof name !== 'string' || !IMAGE_FILE.test(name)) return null;
  if (!name.startsWith('feed/')) { try { if (!fs.lstatSync(path.join(dir, 'images')).isDirectory()) return null; } catch { return null; } }
  // A store catalog picture sits in images/catalog/, which must be a real folder too. The feed's pictures live in feed/images/catalog/ and feed/images/ships/ (names "feed/catalog/<id>.webp", "feed/ships/<id>.webp").
  const inFeed = name.startsWith('feed/');
  const base = inFeed ? path.join(dir, 'feed', 'images') : path.join(dir, 'images');
  const rel = inFeed ? name.slice('feed/'.length) : name;
  if (inFeed) { try { if (!fs.lstatSync(path.join(dir, 'feed')).isDirectory() || !fs.lstatSync(base).isDirectory()) return null; } catch { return null; } }
  const folder = /^(catalog|ships)\//.exec(rel)?.[1];
  if (folder) { try { if (!fs.lstatSync(path.join(base, folder)).isDirectory()) return null; } catch { return null; } }
  const file = path.join(base, rel);
  return isFile(file) ? fs.readFileSync(file) : null;
}

export function createDevStore(dir) {
  return {
    dir: () => dir,
    load() {
      return isFile(path.join(dir, 'catalog.json')) ? readRaw(dir) : null;
    },
    /** store-catalog.json as written by scripts/sync-catalog.mjs, or null when there is none (a damaged file is reported as an error). */
    loadCatalog() {
      const file = path.join(dir, 'store-catalog.json');
      return isFile(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    },
    save(name, doc, baseRev) {
      const file = DOCS[name];
      if (!file) throw new Error('unknown document name');
      if (!Number.isSafeInteger(baseRev) || baseRev < 0) throw new Error('invalid base revision');
      if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('document must be an object');
      const target = path.join(dir, file);
      // Check, write and rename under <data>/.write.lock, the same file the CLI, the MCP server and the desktop store take.
      return withWriteLock(dir, () => {
        const stored = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')).rev : undefined;
        if (stored !== undefined && (!Number.isSafeInteger(stored) || stored < 0)) throw new Error('invalid revision');
        if ((stored ?? 0) !== baseRev) throw new Error('conflict');
        const rev = baseRev + 1;
        writeAtomic(target, JSON.stringify({ ...doc, rev }, null, 2));
        return rev;
      });
    },
    /** pending-import.json (a CCU Game file waiting for the first sync), or null. A damaged file reads as none. */
    loadPending() {
      const file = path.join(dir, 'pending-import.json');
      if (!isFile(file)) return null;
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    },
    /** Writes the pending import, or removes the file for null. */
    savePending(doc) {
      if (doc !== null && (typeof doc !== 'object' || Array.isArray(doc))) throw new Error('document must be an object or null');
      const target = path.join(dir, 'pending-import.json');
      return withWriteLock(dir, () => {
        if (doc === null) { if (isFile(target)) fs.unlinkSync(target); return null; }
        writeAtomic(target, JSON.stringify(doc, null, 2));
        return null;
      });
    },
    importLegacy(source) {
      if (!isFile(path.join(source, 'catalog.json'))) throw new Error('legacy catalog.json is missing');
      const src = fs.realpathSync(source);
      fs.mkdirSync(dir, { recursive: true });
      const dest = fs.realpathSync(dir);
      if (src === dest) throw new Error('source is the app data dir');
      const rels = LEGACY_FILES.filter((f) => isFile(path.join(src, f)));
      for (const f of upgradeFiles(path.join(src, 'upgrades'))) rels.push(`upgrades/${f}`);
      const result = { copied: [], skipped: [] };
      for (const f of imageFiles(path.join(src, 'images'))) rels.push(`images/${f}`);
      // catalog.json is the "import complete" marker: copy it last.
      rels.sort((a, b) => (a === 'catalog.json') - (b === 'catalog.json'));
      for (const rel of rels) {
        const target = path.join(dest, rel);
        if ((KEEP_ON_IMPORT.has(rel) || rel.startsWith('images/')) && exists(target)) { result.skipped.push(rel); continue; }
        writeAtomic(target, fs.readFileSync(path.join(src, rel)));
        result.copied.push(rel);
      }
      return result;
    },
  };
}

/** Reject cross-site reads/writes and non-JSON writes to the dev endpoints. Returns an error string or null. */
export function guardPost(req) {
  const h = req.headers || {};
  const ct = String(h['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (req.method === 'POST' && ct !== 'application/json') return 'content-type must be application/json';
  const site = h['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'cross-site request';
  if (h.origin) {
    let host = '';
    try { host = new URL(h.origin).host; } catch { return 'bad origin'; }
    if (host !== h.host) return 'foreign origin';
  }
  return null;
}

export const readBody = (req) => new Promise((resolve, reject) => {
  let s = '', size = 0, tooLarge = false;
  req.on('data', (c) => {
    size += Buffer.byteLength(c);
    if (size > 64 * 1024) {
      tooLarge = true; s = ''; reject(Object.assign(new Error('request body exceeds 64 KB'), { status: 413 }));
    } else if (!tooLarge) s += c;
  });
  req.on('end', () => { if (tooLarge) return; try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

export default function devData() {
  return {
    name: 'ccu-dev-data',
    apply: 'serve',
    configureServer(server) {
      let runner;
      const syncRunner = () => runner ??= createSyncRunner(path.resolve(process.env.CCU_DATA));
      server.httpServer?.on('close', () => runner?.cancel());
      server.middlewares.use('/__dev/images/', (req, res) => {
        const refused = guardPost(req);
        if (refused) { res.statusCode = 403; res.end(); return; }
        const dir = process.env.CCU_DATA;
        let name = '';
        try { name = decodeURIComponent(req.url.split('?')[0].replace(/^\//, '')); } catch { /* bad escape: no match */ }
        const bytes = req.method === 'GET' && dir ? readImage(path.resolve(dir), name) : null;
        if (!bytes) { res.statusCode = 404; res.end(); return; }
        res.setHeader('content-type', ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', gif: 'image/gif' })[path.extname(name).slice(1)] ?? 'image/webp');
        res.setHeader('cache-control', 'no-cache');
        res.end(bytes);
      });
      server.middlewares.use('/__dev', async (req, res) => {
        const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        const dir = process.env.CCU_DATA;
        if (!dir) return send(500, { error: 'CCU_DATA is not set' });
        const store = createDevStore(path.resolve(dir));
        const refused = guardPost(req);
        if (refused) return send(403, { error: refused });
        try {
          const op = req.url.split('?')[0];
          if (op === '/load') return send(200, store.load());
          if (op === '/dir') return send(200, store.dir());
          if (op === '/catalog') return send(200, store.loadCatalog());
          if (op === '/pending') return send(200, store.loadPending());
          if (op === '/feed') return send(200, readFeed(path.resolve(dir)));
          if (op === '/sync-status') return send(200, syncRunner().status());
          if (op === '/session-status') return send(200, await syncRunner().session('status'));
          if (req.method !== 'POST') return send(405, { error: 'POST required' });
          const body = await readBody(req);
          if (op === '/feed-refresh') return send(200, await refreshFeed({ dir: path.resolve(dir), force: body.force === true, base: feedBase(process.env, { dev: true }) }));
          if (op === '/feed-images') return send(200, await fetchFeedImages({ dir: path.resolve(dir), limit: Math.min(500, Math.max(1, Number(body.limit) || 200)), scope: body.scope === 'ships' ? 'ships' : 'all', base: feedBase(process.env, { dev: true }) }));
          if (op === '/sync-start') return send(200, syncRunner().start(body.kind, { force: body.force === true }));
          if (op === '/sync-confirm') { syncRunner().confirm(body.id, body.accept); return send(200, null); }
          if (op === '/sync-cancel') { syncRunner().cancel(); return send(200, null); }
          if (op === '/login') { await syncRunner().session('login'); return send(200, null); }
          if (op === '/logout') { await syncRunner().session('logout'); return send(200, null); }
          if (op === '/save') return send(200, store.save(body.name, body.doc, body.baseRev));
          if (op === '/pending-save') return send(200, store.savePending(body.doc ?? null));
          if (op === '/import') return send(200, store.importLegacy(path.resolve(body.dir.replace(/^~(?=\/|$)/, os.homedir()))));
          return send(404, { error: 'unknown operation' });
        } catch (e) {
          return send(e.status ?? (e.message === 'conflict' ? 409 : 500), { error: e.message });
        }
      });
    },
  };
}
