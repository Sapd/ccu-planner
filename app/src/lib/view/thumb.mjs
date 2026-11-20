// Pure helpers for ShipThumb.

/** Pixel size of each thumb size; card and hero are full width and sized by CSS (2:1). */
export const THUMB_SIZES = { xs: [32, 16], s: [64, 32], m: [160, 80], card: null, hero: null };

/** Manufacturer initials for the placeholder tile: up to three words, a single word gives two letters, none gives "?". */
export function initials(manufacturer) {
  const words = String(manufacturer ?? '').split(/[^\p{L}\p{N}']+/u).map((w) => w.replace(/'/g, '')).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}

/** The size key, falling back to xs for anything unknown. */
export const thumbSize = (size) => (size in THUMB_SIZES ? size : 'xs');

/** The local file for a size: the large picture for card and hero (falling back to the small one), the small one otherwise; null without a picture. */
export const thumbFile = (image, size) => (size === 'hero' || size === 'card' ? image?.l ?? image?.s : image?.s) ?? null;

/**
 * The picture a ship shows: the one the RSI picture sync saved ({ s, l } under images/), else the signed feed's ("feed/ships/<id>.webp" for both sizes), else null.
 * @param {{ id?: number, image?: { s: string, l: string }|null }|null} ship a planner ship
 * @param {Record<string, string>} feedShips feedShipFiles() of the feed cache
 */
export function shipPicture(ship, feedShips = {}) {
  if (ship?.image) return ship.image;
  const file = ship?.id != null ? feedShips?.[ship.id] : null;
  return file ? { s: file, l: file } : null;
}
