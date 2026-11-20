// Quick-search matcher shared by every list. Pure.
import { norm } from './ships.mjs';

/** Every whitespace-separated word of the query appears in the text; case and punctuation are ignored. An empty query matches. */
export function matchesQuery(text, query) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = norm(text);
  return words.every((w) => hay.includes(w));
}

/** One search string for a row: the non-empty parts joined (arrays are flattened). */
export const searchText = (...parts) => parts.flat().filter((p) => p != null && p !== '').join(' ');
