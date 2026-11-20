// Ship picture helpers. Pure: no Node or browser APIs.

const IMAGE_HOST = 'https://robertsspaceindustries.com/';

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// The same allowlist as the desktop's public_url (app/src-tauri/src/rsi.rs): image paths /i/ and /media/, ship pages /en/pledge/ships/.
const IMAGE_PATHS = [`${IMAGE_HOST}i/`, `${IMAGE_HOST}media/`];
const PAGE_PATH = '/en/pledge/ships/';

/** A stored image url when it is on the RSI image host under /i/ or /media/, else null. */
export const shipImageUrl = (u) => (typeof u === 'string' && IMAGE_PATHS.some((p) => u.startsWith(p)) ? u : null);

/** The og:image URL of a store page, only when it lives on robertsspaceindustries.com. */
export function parseOgImage(html) {
  for (const tag of String(html ?? '').match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bproperty\s*=\s*["']og:image["']/i.test(tag)) continue;
    const m = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const url = m ? decodeEntities((m[1] ?? m[2]).trim()) : '';
    return shipImageUrl(url);
  }
  return null;
}

/** The public store page URL of a catalog ship link; handles links with and without the /en prefix. */
export function shipPageUrl(link) {
  if (!link || typeof link !== 'string' || !link.startsWith('/')) return null;
  const path = `${/^\/en(\/|$)/.test(link) ? '' : '/en'}${link}`;
  return path.startsWith(PAGE_PATH) ? `https://robertsspaceindustries.com${path}` : null;
}

/** The local picture of a ship, { s, l } file names under images/, only when both are recorded and belong to that ship; else null. */
export function shipThumbs(entry, id) {
  const t = entry?.thumbs;
  const original = t && t.s === t.l && new RegExp(`^${id}-original\\.(webp|png|jpe?g|avif|gif)$`).test(t.s);
  return t && (original || (t.s === `${id}-s.webp` && t.l === `${id}-l.webp`)) ? { s: t.s, l: t.l } : null;
}
