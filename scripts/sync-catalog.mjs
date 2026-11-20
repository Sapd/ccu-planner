// The RSI store catalog: every store listing (ships, packs, paints, gear, add-ons, ...) and a small picture for each.
//
//   node scripts/sync-catalog.mjs [--anonymous | --signed-in] [--dry-run] [--no-images] [--data DIR] [--interval MS] [--image-interval MS]
//
// Read-only. One pinned browse query (src/sync/catalog-query.mjs, checked by src/sync/policy.mjs) as POST https://robertsspaceindustries.com/graphql.
// RSI shows the Subscriber store and Concierge-only items, and the account's full ship and paint listings, only to a signed-in account, so
// the default is: use the saved RSI session when there is one (the same RsiClient and session as the other syncs, 1 s between requests), else
// the public catalog (no cookies, same host only, 15 s timeout, back-off on 429). --anonymous forces the public one, --signed-in requires the session.
// Output: <data dir>/store-catalog.json, written atomically, with signedIn, what RSI announced per category (totalCount) against what arrived,
// and the entries dropped. A failed or much smaller result keeps the saved file. Pictures (RSI's own hosts, common image types, at most 20 MB,
// always without cookies) are downscaled with sharp to <data dir>/images/catalog/<id>.webp, 0.3 s apart; ones already on disk are kept and
// pictures of items that left the catalog are removed after a complete run. --dry-run prints the requests it would send and sends none.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cliControl } from '../src/sync/cli-control.mjs';
import { DATA_DIR, checkLegacyData } from '../src/data.mjs';
import { CATALOG_CATEGORIES, readCatalog } from '../src/logic/store-catalog.mjs';
import { syncCatalog } from '../src/catalog-sync.mjs';
import { RsiClient } from '../src/rsi.mjs';
import { loadSession, NeedLoginError } from '../src/session.mjs';
import { acquireSyncLock } from '../src/sync/lock.mjs';
import { CATALOG_PATH } from '../src/sync/catalog-query.mjs';
import { readCapped, MAX_LISTING_BYTES } from '../src/image-sync.mjs';

const USAGE = 'usage: node scripts/sync-catalog.mjs [--anonymous | --signed-in] [--dry-run] [--no-images] [--data DIR] [--interval MS] [--image-interval MS]';
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const posInt = (v) => (/^[1-9]\d*$/.test(String(v)) ? Number(v) : null);
if (flag('anonymous') && flag('signed-in')) { console.error(`--anonymous and --signed-in exclude each other\n${USAGE}`); process.exit(2); }
const interval = flag('interval') ? posInt(opt('interval')) : 1000;
const imageInterval = flag('image-interval') ? posInt(opt('image-interval')) : 300;
if (interval == null || imageInterval == null) { console.error(`--interval and --image-interval need a positive integer (ms)\n${USAGE}`); process.exit(2); }

if (!opt('data')) checkLegacyData();
const dir = opt('data') ? path.resolve(opt('data')) : DATA_DIR;
const outFile = path.join(dir, 'store-catalog.json');
const imagesDir = path.join(dir, 'images');

if (flag('dry-run')) {
  for (const g of CATALOG_CATEGORIES) {
    console.log(`POST /graphql  products ${JSON.stringify(g.products)}  (pages of 100 until a page is not full)`);
    for (const s of g.facet?.subs ?? []) console.log(`POST /graphql  products ${JSON.stringify(g.products)}  tag ${g.facet.id}:${s.tag}`);
  }
  console.log(`(sent ${flag('anonymous') ? 'without a session' : flag('signed-in') ? 'with the saved RSI session' : 'with the saved RSI session when there is one, else without'})`);
  console.log(`dry run: no request made; pictures would go to ${path.join(imagesDir, 'catalog')}`);
  process.exit(0);
}

function writeBytesAtomic(f, bytes) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, f); } finally { fs.rmSync(tmp, { force: true }); }
}
const exists = (name) => { try { return fs.statSync(path.join(imagesDir, name)).size > 0; } catch { return false; } };
let previous = null;
try { previous = readCatalog(JSON.parse(fs.readFileSync(outFile, 'utf8'))); } catch { /* none yet, or unreadable: start fresh */ }

const control = cliControl();
// The saved session decides between the signed-in and the public catalog (never read with --anonymous).
const useSession = flag('anonymous') ? false : flag('signed-in') ? true : !!loadSession();
let releaseLock = () => {};
const finish = (code, message) => { releaseLock(); control.close(); if (message) console.error(message); process.exit(code); };
let post = null;
if (useSession) {
  try {
    releaseLock = acquireSyncLock(dir); // one signed-in sync at a time per data folder, like the other syncs
    const client = new RsiClient({ cancelled: control.cancelled, minIntervalMs: Math.max(1000, interval), log: (m) => console.log('  ' + m) });
    await client.init();
    // The same pinned body as the public run, through the session's cookies. The client's allowlist (validateRequest) checks it again.
    post = async (body) => {
      const res = await client.request(CATALOG_PATH, { method: 'POST', json: body, headers: { 'x-csrf-token': client.session.csrf } });
      return JSON.parse((await readCapped(res, MAX_LISTING_BYTES, 'listing')).toString('utf8'));
    };
  } catch (e) {
    finish(control.cancelled() ? 130 : 1, e.message);
  }
}
const { default: sharp } = await import('sharp');
const resize = (buf) => sharp(buf, { limitInputPixels: 100e6 }).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
const listImages = () => { try { return fs.readdirSync(path.join(imagesDir, 'catalog')).filter((n) => /^\d+\.webp$/.test(n)).map((n) => `catalog/${n}`); } catch { return []; } };
const removeImage = (name) => fs.rmSync(path.join(imagesDir, name), { force: true });
let result;
try {
  result = await syncCatalog({
    previous, post, signedIn: useSession, cancelled: control.cancelled, interval, imageInterval, images: !flag('no-images'),
    fetch: (...a) => { if (control.cancelled()) throw new Error('Sync cancelled'); return fetch(...a); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    resize, writeImage: (name, bytes) => writeBytesAtomic(path.join(imagesDir, name), bytes), exists, listImages, removeImage,
    save: (c) => writeBytesAtomic(outFile, JSON.stringify(c, null, 2)),
    progress: (e) => console.log(`progress ${JSON.stringify(e)}`), log: console.log,
  });
} catch (e) {
  if (control.cancelled()) finish(130, 'Sync cancelled; progress saved');
  finish(1, e instanceof NeedLoginError ? e.message : `catalog sync failed: ${e.message}${previous ? ' (the saved catalog is unchanged)' : ''}`);
}
const cancelled = control.cancelled();
const perCategory = Object.entries(result.counts).filter(([k]) => !k.includes('/')).map(([k, v]) => `${k} ${v.got}/${v.expected}`).join(', ');
console.log(`catalog (${result.signedIn ? 'signed in' : 'public'}): ${result.items} items, ${result.thumbs} with a picture, ${result.fetched} pictures downloaded, ${result.failed} failed, ${result.removed} old pictures removed${result.stopped ? ' (stopped early)' : ''}`);
console.log(`catalog: got/expected per listing: ${perCategory}; Subscriber ${result.subscriber}, Concierge ${result.concierge}; ${result.dropped} entries dropped${result.short.length ? `; INCOMPLETE: ${result.short.join(', ')}` : ''}`);
if (result.stopped) console.error('RSI is rate-limiting; the catalog was saved without all pictures, run again later');
finish(cancelled ? 130 : result.stopped ? 3 : 0);
