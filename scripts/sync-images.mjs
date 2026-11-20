// Ship pictures: reads the public og:image of each catalog ship's store page,
// downloads it once and stores two small WebP files per ship.
//
//   node scripts/sync-images.mjs [--limit N] [--refresh] [--dry-run] [--data DIR] [--interval MS]
//
// Unauthenticated GET of https://robertsspaceindustries.com/en<ship.link>,
// same host only, no cookies, no other method, 15 s timeout per request,
// 1 s spacing (also between redirect hops), back-off on 429, a clean stop after
// 3 ships in a row stay rate-limited. Ships that already have a url in
// ship-images.json are skipped unless --refresh; a failed refresh keeps the old
// url. A failed page is recorded as { url: null, error } and retried on the next
// run. Output: <data dir>/ship-images.json, written after every ship.
// The picture itself (same host, content-type image/*, at most 20 MB) is
// downscaled with sharp to <data dir>/images/<id>-s.webp (320x160, q70) and
// <id>-l.webp (1280x640, q75), cover-cropped, written atomically; the entry gets
// thumbs { s, l, sourceUrl, bytes }. A ship whose thumbs.sourceUrl equals its url
// and whose files exist is skipped; missing files are filled in without a page
// fetch. --refresh downloads everything again. After an import, an existing
// (older) image file is kept as it is until --refresh.
// --dry-run prints the URLs it would fetch and makes no request.

import crypto from 'node:crypto';
import { cliControl } from '../src/sync/cli-control.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, checkLegacyData } from '../src/data.mjs';
import { shipPageUrl } from '../src/logic/images.mjs';
import { syncImages, shipWork } from '../src/image-sync.mjs';

const USAGE = 'usage: node scripts/sync-images.mjs [--limit N] [--refresh] [--dry-run] [--data DIR] [--interval MS]';
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const posInt = (v) => (/^[1-9]\d*$/.test(String(v)) ? Number(v) : null);

let limit = null;
if (flag('limit')) {
  limit = posInt(opt('limit'));
  if (limit == null) { console.error(`--limit needs a positive integer\n${USAGE}`); process.exit(2); }
}
const interval = flag('interval') ? posInt(opt('interval')) : 1000;
if (interval == null) { console.error(`--interval needs a positive integer (ms)\n${USAGE}`); process.exit(2); }

if (!opt('data')) checkLegacyData();
const dir = opt('data') ? path.resolve(opt('data')) : DATA_DIR;
const outFile = path.join(dir, 'ship-images.json');
const readJson = (f, dflt) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : dflt);
const writeAtomic = (f, v) => writeBytesAtomic(f, JSON.stringify(v, null, 2));
function writeBytesAtomic(f, bytes) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, f);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
const imagesDir = path.join(dir, 'images');
const exists = (name) => { try { return fs.statSync(path.join(imagesDir, name)).size > 0; } catch { return false; } };

const catalog = readJson(path.join(dir, 'catalog.json'), null);
if (!catalog) { console.error(`no catalog.json in ${dir}`); process.exit(1); }
const store = readJson(outFile, { fetchedAt: null, images: {} });
store.images ??= {};
const ships = catalog.ships.map((s) => ({ id: s.id, name: s.name, page: shipPageUrl(s.link) }));

if (flag('dry-run')) {
  let todo = ships.filter((s) => { const w = shipWork(store, s, { refresh: flag('refresh'), exists }); return w.page || w.image; });
  if (limit != null) todo = todo.slice(0, limit);
  let pages = 0;
  for (const s of todo) {
    const w = shipWork(store, s, { refresh: flag('refresh'), exists });
    if (w.page) pages++;
    console.log(`${s.id}\t${s.name}\t${w.page ? (s.page ?? '(no usable link)') : '(page known)'}\t${w.image ? 'image' : ''}`);
  }
  console.log(`dry run: ${pages} page(s) and ${todo.filter((s) => shipWork(store, s, { refresh: flag('refresh'), exists }).image).length} image(s) would be fetched, no request made`);
  process.exit(0);
}

// Every entry is saved as it finishes, so Ctrl-C loses nothing; the handler only exits.
const control = cliControl();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// sharp is only needed for a real run, so the dry run and the tests never load it.
const { default: sharp } = await import('sharp');
const webp = (buf, w, h, quality) => sharp(buf, { limitInputPixels: 100e6 }).rotate().resize(w, h, { fit: 'cover' }).webp({ quality }).toBuffer();
const resize = async (buf) => ({ s: await webp(buf, 320, 160, 70), l: await webp(buf, 1280, 640, 75) });
const writeImage = (name, bytes) => writeBytesAtomic(path.join(imagesDir, name), bytes);
const r = await syncImages({ ships, store, cancelled: control.cancelled, fetch: (...args) => { if (control.cancelled()) throw new Error('Sync cancelled'); return fetch(...args); }, sleep, resize, writeImage, exists, save: (s) => writeAtomic(outFile, s), limit, refresh: flag('refresh'), interval, log: console.log });
console.log(`images: ${r.ok} found, ${r.failed} failed, ${r.fetched} fetched${r.stopped ? ' (stopped early)' : ''}`);
const cancelled = control.cancelled();
control.close();
process.exit(cancelled ? 130 : r.stopped ? 3 : 0);
