// Builds the signed feed folder (what .github/workflows/feed.yml publishes), with the network and the clock outside it: the caller hands in
// the parsed events, the store catalog document and the folder holding its pictures. scripts/build-feed.mjs is the command-line wrapper.
//
//   <out>/index.html            a few lines saying what the site is
//   <out>/feed/events.json      the sale events (validated strictly)
//   <out>/feed/store-catalog.json + feed/images/catalog/<id>.webp   only pictures the catalog uses and that exist
//   <out>/feed/images/ships/<id>.webp   one picture per ship id the caller names and that exists as a WebP in the pictures folder
//   <out>/feed/manifest.json    { schema, generatedAt, files: { name: { sha256, size } } }, files sorted by name
//   <out>/feed/manifest.json.sig  base64 ed25519 signature over the exact bytes of manifest.json
// The signature is checked with the key embedded in the app before the build counts as done: a private key that does not belong to it fails here,
// not on every user's machine.

import fs from 'node:fs';
import path from 'node:path';
import { FEED_SCHEMA, FEED_IMAGE, FEED_MAX_TOTAL_BYTES, isWebp, readEvents } from './logic/feed.mjs';
import { readCatalog } from './logic/store-catalog.mjs';
import { FEED_PUBLIC_KEY, sha256, signManifest, verifyManifest } from './feed.mjs';

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CCU Planner data feed</title><meta name="robots" content="noindex"></head>
<body><h1>CCU Planner data feed</h1>
<p>This is not a website. It hosts the signed data files that <a href="https://github.com/Sapd/ccu-planner">CCU Planner</a> downloads: sale events, a snapshot of RSI's public store catalog and the ships' pictures. Unofficial fan tool, not affiliated with Cloud Imperium Games or Roberts Space Industries.</p>
</body></html>
`;

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/**
 * @param {object} o
 * @param {string} o.outDir
 * @param {string|import('node:crypto').KeyObject} o.privateKey PEM text or key object
 * @param {object} o.events parsed feed-src/events.json
 * @param {object|null} [o.catalog] a store-catalog.json document (public only), or null to leave the catalog out of this feed
 * @param {string|null} [o.imagesDir] folder holding catalog/<id>.webp for that catalog and ships/<id>.webp for the ships
 * @param {number[]} [o.shipIds] the ships whose picture (ships/<id>.webp in imagesDir) goes into the feed; the ones without a valid file are left out
 * @param {string} [o.generatedAt]
 * @param {import('node:crypto').KeyObject} [o.publicKey] the key the result is checked against (the embedded one; tests pass their own)
 * @returns {{ files: number, images: number, ships: number, items: number, manifest: object, rejectedImages: string[] }}
 */
export function buildFeed({ outDir, privateKey, events, catalog = null, imagesDir = null, shipIds = [], generatedAt = new Date().toISOString(), publicKey = FEED_PUBLIC_KEY }) {
  const feed = path.join(outDir, 'feed');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(feed, 'images', 'catalog'), { recursive: true });
  fs.mkdirSync(path.join(feed, 'images', 'ships'), { recursive: true });
  const files = new Map(); // name -> bytes
  files.set('events.json', json({ schema: FEED_SCHEMA, events: readEvents(events, { strict: true }) }));
  let images = 0, items = 0, ships = 0;
  const rejectedImages = [];
  if (catalog) {
    const doc = readCatalog(catalog);
    if (!doc) throw new Error('the store catalog is not a catalog document');
    if (doc.signedIn || catalog.signedIn === true) throw new Error('refusing to publish a signed-in catalog (Subscriber and Concierge items are not public)');
    // Everything that gets signed is checked here, whatever cache it came from: a picture counts only when it is named catalog/<this item's id>.webp
    // and its bytes are a WebP container of an allowed size; anything else is left out (and reported), never signed.
    const out = { ...doc, signedIn: false, items: doc.items.map((i) => {
      const m = i.thumb && /^catalog\/(\d+)\.webp$/.exec(i.thumb);
      const file = m && Number(m[1]) === i.id && imagesDir && path.join(imagesDir, i.thumb);
      let bytes = null;
      try { bytes = file && fs.lstatSync(file).isFile() ? fs.readFileSync(file) : null; } catch { bytes = null; }
      if (bytes && !isWebp(bytes)) { rejectedImages.push(i.thumb); bytes = null; }
      if (bytes) { files.set(`images/${i.thumb}`, bytes); images++; }
      return { ...i, thumb: bytes ? i.thumb : null };
    }) };
    items = out.items.length;
    files.set('store-catalog.json', json(out));
  }
  // Ship pictures: named by the caller's ship ids, each checked like a catalog picture (a regular file that is a WebP container of an allowed size).
  for (const id of [...new Set(shipIds)]) {
    if (!Number.isSafeInteger(id) || id <= 0 || !imagesDir) continue;
    const name = `ships/${id}.webp`;
    let bytes = null;
    try { const file = path.join(imagesDir, name); bytes = fs.lstatSync(file).isFile() ? fs.readFileSync(file) : null; } catch { bytes = null; }
    if (bytes && !isWebp(bytes)) { rejectedImages.push(name); bytes = null; }
    if (bytes) { files.set(`images/${name}`, bytes); ships++; }
  }
  const names = [...files.keys()].sort();
  if ([...files.values()].reduce((n, b) => n + b.length, 0) > FEED_MAX_TOTAL_BYTES) throw new Error('the feed would announce more data than the clients accept');
  for (const name of names) {
    fs.mkdirSync(path.dirname(path.join(feed, name)), { recursive: true });
    fs.writeFileSync(path.join(feed, name), files.get(name));
  }
  const manifest = { schema: FEED_SCHEMA, generatedAt, files: Object.fromEntries(names.map((n) => [n, { sha256: sha256(files.get(n)), size: files.get(n).length }])) };
  const bytes = json(manifest);
  const sig = signManifest(bytes, privateKey);
  try { verifyManifest(bytes, sig, publicKey); } catch { throw new Error('the signing key does not match the public key in src/feed-public-key.json'); }
  fs.writeFileSync(path.join(feed, 'manifest.json'), bytes);
  fs.writeFileSync(path.join(feed, 'manifest.json.sig'), `${sig}\n`);
  fs.writeFileSync(path.join(outDir, 'index.html'), INDEX_HTML);
  return { files: names.length, images, ships, items, manifest, rejectedImages, imageNames: names.filter((n) => FEED_IMAGE.test(n)).length };
}
