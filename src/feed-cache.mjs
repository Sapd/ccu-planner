// The feed build's cache folder (restored by .github/workflows/feed.yml from actions/cache) is untrusted input: whatever sits in it ends up
// signed with the real key. This checks it before anything is used:
//   <cache>/store-catalog.json            a public catalog whose item pictures are named exactly catalog/<item id>.webp
//   <cache>/images/catalog/<digits>.webp  real WebP pictures of at most 480 px and 4 MiB
// Anything else is deleted (and reported); a damaged catalog document is deleted as a whole, so the build starts from RSI again.

import fs from 'node:fs';
import path from 'node:path';
import { FEED_MAX_BYTES, isWebp } from './logic/feed.mjs';
import { readCatalog } from './logic/store-catalog.mjs';

const MAX_PIXELS_SIDE = 480;

/** True when the catalog document is acceptable as the cache of a public feed: not signed in, every item valid, every thumb catalog/<its id>.webp. */
export function catalogCacheOk(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items) || doc.signedIn === true) return false;
  const read = readCatalog(doc);
  if (!read || read.items.length !== doc.items.length) return false; // an invalid item is a sign of tampering, not a reason to carry the rest on
  return doc.items.every((i) => i.thumb == null || i.thumb === `catalog/${i.id}.webp`);
}

/**
 * Deletes what does not belong in the cache. `sharp` decodes the picture headers (an injected module, so the check is testable without a download).
 * @returns {Promise<{ removed: string[], catalog: object|null, changed: boolean }>} catalog: the validated document, or null
 */
export async function sanitizeFeedCache({ cacheDir, sharp, log = () => {} }) {
  const removed = [];
  const drop = (file, why) => { fs.rmSync(file, { recursive: true, force: true }); removed.push(path.relative(cacheDir, file)); log(`feed cache: removed ${path.relative(cacheDir, file)} (${why})`); };

  const folder = path.join(cacheDir, 'images', 'catalog');
  let entries = [];
  try { entries = fs.readdirSync(folder); } catch { /* no pictures yet */ }
  for (const name of entries) {
    const file = path.join(folder, name);
    let st;
    try { st = fs.lstatSync(file); } catch { continue; }
    if (!/^\d+\.webp$/.test(name)) { drop(file, 'not a picture name'); continue; }
    if (!st.isFile()) { drop(file, 'not a regular file'); continue; }
    if (st.size > FEED_MAX_BYTES.image) { drop(file, 'too large'); continue; }
    const bytes = fs.readFileSync(file);
    if (!isWebp(bytes)) { drop(file, 'not a WebP container'); continue; }
    try {
      const meta = await sharp(bytes, { limitInputPixels: 100e6 }).metadata();
      if (meta.format !== 'webp' || !(meta.width >= 1 && meta.width <= MAX_PIXELS_SIDE) || !(meta.height >= 1 && meta.height <= MAX_PIXELS_SIDE)) drop(file, 'not a WebP of an allowed size');
    } catch { drop(file, 'cannot be decoded'); }
  }

  let catalog = null;
  const catalogFile = path.join(cacheDir, 'store-catalog.json');
  let st = null;
  try { st = fs.lstatSync(catalogFile); } catch { /* no catalog yet */ }
  if (st) {
    try {
      if (!st.isFile() || st.size > FEED_MAX_BYTES.json) throw new Error('not a catalog file');
      catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
      if (!catalogCacheOk(catalog)) throw new Error('not an acceptable public catalog');
    } catch (e) { catalog = null; drop(catalogFile, e.message); }
  }
  return { removed, catalog, changed: removed.length > 0 };
}
