// Language of the texts the planner shows. English is the source language and the default: the CLI and the MCP server
// never set a locale, so everything they print stays as written in English. The desktop app loads the German tables
// (src/logic/i18n/de/index.mjs, app/src/lib/i18n/de/*.js) and sets the locale from the system language or the
// user's choice.
//
// Two kinds of text:
// - t('English text {name}', { name }): a fixed text. The English text is its own key; a table maps it to the
//   translation, which may be a string with the same {placeholders} or a function of the params. Every literal passed
//   to t() or N_() is checked by test/i18n.test.mjs to have a German entry.
// - loc('key', (...args) => `English ${...}`): a text builder that assembles a sentence from data. In another locale
//   its translated twin with the same key and arguments runs instead. test/i18n.test.mjs checks every builder has one.
// N_('English') only marks a text for translation where it is defined (a label in a constant); the place that shows
// it calls t() on it.

export const LOCALES = Object.freeze(['en', 'de']);
export const DEFAULT_LOCALE = 'en';

let current = DEFAULT_LOCALE;
const texts = { de: new Map() };
const builders = { de: new Map() };
const builderKeys = new Set();
// Texts asked for in a non-English locale that had no translation (for finding gaps in the running app).
const missing = new Set();
export const listMissing = () => [...missing];

/** The locale for a language tag ('de-DE' -> 'de'), or null when the planner has no texts in that language. */
export function localeOf(tag) {
  const base = typeof tag === 'string' ? tag.trim().toLowerCase().split(/[-_]/)[0] : '';
  return LOCALES.includes(base) ? base : null;
}

export const getLocale = () => current;
/** Sets the locale every text uses from now on; unknown values fall back to English. */
export const setLocale = (locale) => { current = localeOf(locale) ?? DEFAULT_LOCALE; return current; };

/** Runs fn with `locale` set, then restores the previous one (tests, and the worker answering one job). */
export function withLocale(locale, fn) {
  const before = current;
  setLocale(locale);
  try { return fn(); } finally { current = before; }
}

/**
 * Adds translations for a locale: `texts` maps an English text to its translation (string or (params) => string),
 * `builders` maps a builder key to its translated twin. A text given twice with a different translation is an error,
 * so two tables cannot disagree on the same English words.
 */
export function addTranslations(locale, { texts: tx = {}, builders: bx = {} } = {}) {
  const t = texts[locale];
  const b = builders[locale];
  if (!t || !b) throw new Error(`Unknown locale: ${locale}`);
  for (const [en, tr] of Object.entries(tx)) {
    if (t.has(en) && String(t.get(en)) !== String(tr)) throw new Error(`Two translations for "${en}"`);
    t.set(en, tr);
  }
  for (const [key, fn] of Object.entries(bx)) {
    if (typeof fn !== 'function') throw new Error(`Builder ${key} is not a function`);
    b.set(key, fn);
  }
}

// 'Plan##verb': the same English word in another role (a button, not a heading); English shows it without the suffix.
const CONTEXT = /##\w+$/;
const fill = (s, params) => (params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params && params[k] != null ? String(params[k]) : m)) : s);

/** A fixed text in the current locale. `en` is the English text (and the key); {name} placeholders are filled from params. */
export function t(en, params) {
  if (en == null) return en;
  const tr = current === DEFAULT_LOCALE ? undefined : texts[current]?.get(en);
  if (tr === undefined && current !== DEFAULT_LOCALE) missing.add(String(en));
  if (typeof tr === 'function') return tr(params ?? {});
  return fill(tr ?? String(en).replace(CONTEXT, ''), params);
}

/** Marks an English text for translation without translating it here (see the header). */
export const N_ = (en) => en;

/** True when `en` has a translation in `locale`. */
export const hasText = (locale, en) => !!texts[locale]?.has(en);

/** A text builder: `en` in English, its registered twin under `key` in other locales. Keys are unique. */
export function loc(key, en) {
  if (builderKeys.has(key)) throw new Error(`Duplicate text builder: ${key}`);
  builderKeys.add(key);
  const f = (...args) => {
    const tr = current === DEFAULT_LOCALE ? null : builders[current]?.get(key);
    return tr ? tr(...args) : en(...args);
  };
  f.i18nKey = key;
  return f;
}

/** The keys of every builder made so far, and of the registered twins in `locale` (for the completeness test). */
export const listBuilders = () => [...builderKeys];
export const listTwins = (locale) => [...(builders[locale]?.keys() ?? [])];
export const listTexts = (locale) => [...(texts[locale]?.keys() ?? [])];

/** Plural pick: `one` for exactly 1, else `other`. Both are English texts passed through t() with { n, ...params }. */
export const tn = (n, one, other, params = {}) => t(n === 1 ? one : other, { n, ...params });
