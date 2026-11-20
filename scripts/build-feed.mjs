// Builds the signed data feed into a folder (published by .github/workflows/feed.yml, testable by hand).
//
//   node scripts/build-feed.mjs --out DIR --key PEM_FILE [--events FILE] [--cache DIR] [--no-catalog] [--no-images] [--interval MS] [--image-interval MS]
//
// The signing key is a PEM file (--key) or, without --key, the text of the FEED_SIGNING_KEY environment variable; it is never printed.
// The store catalog is the anonymous public one (scripts/sync-catalog.mjs's code, no session): --cache is where the previous run's catalog and
// pictures live, so only new pictures are downloaded (the workflow keeps that folder with actions/cache). When RSI fails or answers with
// something much smaller the previous catalog is published again, and without one the feed simply has no catalog this time (clients keep theirs).
// The cache is untrusted (it is restored from actions/cache): src/feed-cache.mjs deletes anything that is not a real picture or a valid public catalog
// before it is used, and src/feed-build.mjs checks every picture again before it is signed.
// With GITHUB_OUTPUT set it writes cache-changed=true|false so the workflow only saves the cache when it changed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildFeed } from '../src/feed-build.mjs';
import { syncCatalog } from '../src/catalog-sync.mjs';
import { sanitizeFeedCache } from '../src/feed-cache.mjs';
import { isWebp } from '../src/logic/feed.mjs';

const USAGE = 'usage: node scripts/build-feed.mjs --out DIR --key PEM_FILE [--events FILE] [--cache DIR] [--no-catalog] [--no-images] [--interval MS] [--image-interval MS]';
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const posInt = (v) => (/^[1-9]\d*$/.test(String(v)) ? Number(v) : null);
const fail = (m) => { console.error(`${m}\n${USAGE}`); process.exit(2); };

const out = opt('out');
if (!out) fail('--out is required');
const keyPem = opt('key') ? fs.readFileSync(opt('key'), 'utf8') : process.env.FEED_SIGNING_KEY;
if (!keyPem) fail('--key (a PEM file) or the FEED_SIGNING_KEY environment variable is required');
let privateKey;
try { privateKey = crypto.createPrivateKey(keyPem); } catch { fail('the signing key is not a readable PEM private key'); }
const interval = flag('interval') ? posInt(opt('interval')) : 1000;
const imageInterval = flag('image-interval') ? posInt(opt('image-interval')) : 300;
if (interval == null || imageInterval == null) fail('--interval and --image-interval need a positive integer (ms)');
const eventsFile = path.resolve(opt('events', new URL('../feed-src/events.json', import.meta.url).pathname));
const cache = path.resolve(opt('cache', path.join(os.tmpdir(), 'ccu-feed-cache')));
const imagesDir = path.join(cache, 'images');
const catalogFile = path.join(cache, 'store-catalog.json');

const writeAtomic = (f, bytes) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, f); } finally { fs.rmSync(tmp, { force: true }); }
};

let cacheChanged = false;
let catalog = null;
if (!flag('no-catalog')) {
  const { default: sharp } = await import('sharp');
  // The restored cache is checked before anything uses it (pictures are decoded, the catalog and its picture names validated); what fails is deleted.
  const checked = await sanitizeFeedCache({ cacheDir: cache, sharp, log: console.log });
  if (checked.changed) cacheChanged = true;
  const previous = checked.catalog; // null: sign-in or tampering is never carried into the public feed
  const resize = (buf) => sharp(buf, { limitInputPixels: 100e6 }).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  const exists = (name) => { try { return isWebp(fs.readFileSync(path.join(imagesDir, name))); } catch { return false; } };
  const listImages = () => { try { return fs.readdirSync(path.join(imagesDir, 'catalog')).filter((n) => /^\d+\.webp$/.test(n)).map((n) => `catalog/${n}`); } catch { return []; } };
  try {
    const r = await syncCatalog({
      previous, signedIn: false, interval, imageInterval, images: !flag('no-images'),
      fetch, sleep: (ms) => new Promise((res) => setTimeout(res, ms)), resize,
      writeImage: (name, bytes) => { cacheChanged = true; writeAtomic(path.join(imagesDir, name), bytes); }, exists, listImages,
      removeImage: (name) => { cacheChanged = true; fs.rmSync(path.join(imagesDir, name), { force: true }); },
      save: (c) => writeAtomic(catalogFile, JSON.stringify(c, null, 2)),
      log: console.log,
    });
    console.log(`catalog: ${r.items} items, ${r.thumbs} with a picture, ${r.fetched} pictures downloaded, ${r.failed} failed, ${r.removed} old pictures removed${r.stopped ? ' (RSI rate-limited; the rest follows next run)' : ''}`);
  } catch (e) {
    console.error(`catalog sync failed: ${e.message}${previous ? ' (publishing the previous catalog)' : ' (no catalog in this feed)'}`);
  }
  try { catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8')); if (catalog.signedIn) catalog = null; } catch { catalog = null; }
}

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `cache-changed=${cacheChanged}\n`);
const result = buildFeed({ outDir: path.resolve(out), privateKey, events: JSON.parse(fs.readFileSync(eventsFile, 'utf8')), catalog, imagesDir });
if (result.rejectedImages.length) console.error(`left out ${result.rejectedImages.length} picture(s) that are not valid WebP files: ${result.rejectedImages.join(', ')}`);
console.log(`feed built in ${path.resolve(out)}: ${result.files} files, ${result.items} catalog items, ${result.images} pictures, generatedAt ${result.manifest.generatedAt}`);
