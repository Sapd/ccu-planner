// The cookies of an RSI session that are kept: the RSI authentication namespace plus Cloudflare access cookies. No analytics,
// marketing, preference or unrelated cookies. The desktop app reads the same file (app/src-tauri/src/session_store.rs needed_cookie).
import rule from './session-cookies.json' with { type: 'json' };

export const neededCookie = (name) => rule.prefixes.some((p) => name.startsWith(p)) || rule.names.includes(name);
