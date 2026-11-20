// The app's language: German when the system or browser prefers it, else English, unless the user picked one under
// Help (remembered in localStorage). Switching re-renders every page (App.svelte keys the shell on lang.code); the
// planning session caches texts per locale, so nothing is planned again.
import './i18n/de/index.js';
import { setLocale, localeOf, DEFAULT_LOCALE } from '../../../src/logic/i18n.mjs';

const KEY = 'ccuplanner.language';
const storage = () => { try { return localStorage; } catch { return null; } };

/** The locale to start with: the saved choice, else the first supported language the system prefers, else English. */
export function initialLocale(saved = storage()?.getItem(KEY), languages = globalThis.navigator?.languages ?? [globalThis.navigator?.language]) {
  const pick = localeOf(saved);
  if (pick) return pick;
  for (const tag of languages ?? []) { const l = localeOf(tag); if (l) return l; }
  return DEFAULT_LOCALE;
}

const apply = (code) => {
  const l = setLocale(code);
  try { document.documentElement.lang = l; } catch { /* no document (worker, tests) */ }
  return l;
};

export const lang = $state({ code: apply(initialLocale()) });

/** Switches the language and remembers the choice. */
export function setLanguage(code) {
  const l = apply(code);
  try { storage()?.setItem(KEY, l); } catch { /* storage unavailable: only for this run */ }
  lang.code = l;
}
