// The feed build's cache folder (restored by .github/workflows/feed.yml from actions/cache) is untrusted input: whatever sits in it ends up
// signed with the real key. This checks it before anything is used:
//   <cache>/store-catalog.json            a public catalog whose item pictures are named exactly catalog/<item id>.webp
//   <cache>/images/catalog/<digits>.webp  real WebP pictures of at most 480 px and 4 MiB
//   <cache>/images/ships/<digits>.webp    real WebP pictures of at most 640 px and 4 MiB
//   <cache>/ship-sources.json             { ships: { "<id>": { page, url, ... } } }: where each ship picture came from (RSI page and image addresses)
// Anything else is deleted (and reported); a damaged catalog document is deleted as a whole, so the build starts from RSI again.

import fs from 'node:fs';
import path from 'node:path';
import { FEED_MAX_BYTES, isWebp } from './logic/feed.mjs';
import { readCatalog } from './logic/store-catalog.mjs';
import { shipImageUrl, shipPageUrl } from './logic/images.mjs';

/** The picture folders of the cache and the longest side a picture in each may have. */
const PICTURE_FOLDERS = [['catalog', 480], ['ships', 640]];

/** True when the catalog document is acceptable as the cache of a public feed: not signed in, every item valid, every thumb catalog/<its id>.webp. */
export function catalogCacheOk(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items) || doc.signedIn === true) return false;
  const read = readCatalog(doc);
  if (!read || read.items.length !== doc.items.length) return false; // an invalid item is a sign of tampering, not a reason to carry the rest on
  return doc.items.every((i) => i.thumb == null || i.thumb === `catalog/${i.id}.webp`);
}

/** True when the ship-source notes are acceptable: { ships: { "<id>": { page, url, ... } } } with RSI page and image addresses only. */
export function shipSourcesOk(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !doc.ships || typeof doc.ships !== 'object' || Array.isArray(doc.ships)) return false;
  return Object.entries(doc.ships).every(([id, e]) => /^[1-9]\d*$/.test(id) && e && typeof e === 'object'
    && ['checkedAt', 'failedAt'].every((k) => e[k] == null || (typeof e[k] === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e[k]) && Number.isFinite(Date.parse(e[k]))))
    && (e.url == null || shipImageUrl(e.url) === e.url) && (e.page == null || (typeof e.page === 'string' && shipPageUrl(new URL(e.page).pathname) === e.page)));
}

/**
 * Deletes what does not belong in the cache. `sharp` decodes the picture headers (an injected module, so the check is testable without a download).
 * @returns {Promise<{ removed: string[], catalog: object|null, shipSources: object|null, changed: boolean }>} catalog, shipSources: the validated documents, or null
 */
export async function sanitizeFeedCache({ cacheDir, sharp, log = () => {} }) {
  const removed = [];
  const drop = (file, why) => { fs.rmSync(file, { recursive: true, force: true }); removed.push(path.relative(cacheDir, file)); log(`feed cache: removed ${path.relative(cacheDir, file)} (${why})`); };

  const sanitizePictures = async (folder, maxSide) => {
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
        if (meta.format !== 'webp' || !(meta.width >= 1 && meta.width <= maxSide) || !(meta.height >= 1 && meta.height <= maxSide)) drop(file, 'not a WebP of an allowed size');
      } catch { drop(file, 'cannot be decoded'); }
    }
  };
  for (const [name, maxSide] of PICTURE_FOLDERS) await sanitizePictures(path.join(cacheDir, 'images', name), maxSide);

  // A JSON document of the cache: parsed when it is a regular file of an allowed size and `ok` accepts it, otherwise deleted as a whole.
  const readDoc = (name, ok, what) => {
    const file = path.join(cacheDir, name);
    let st = null;
    try { st = fs.lstatSync(file); } catch { return null; }
    try {
      if (!st.isFile() || st.size > FEED_MAX_BYTES.json) throw new Error(`not a ${what} file`);
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!ok(doc)) throw new Error(`not an acceptable ${what}`);
      return doc;
    } catch (e) { drop(file, e.message); return null; }
  };
  const catalog = readDoc('store-catalog.json', catalogCacheOk, 'public catalog');
  const shipSources = readDoc('ship-sources.json', shipSourcesOk, 'ship source list');
  return { removed, catalog, shipSources, changed: removed.length > 0 };
}
