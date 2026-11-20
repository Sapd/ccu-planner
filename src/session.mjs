// Session handling. The browser is only used to log in (by you, in a visible
// window) and to read the session cookies + CSRF token from the saved profile.
// Everything else goes through plain HTTP in src/rsi.mjs.

import { hasSigninForm } from './sync/signin.mjs';
import { neededCookie } from './sync/session-cookies.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE_DIR = path.join(ROOT, '.local', 'profile');
export const SESSION_FILE = path.join(ROOT, '.local', 'session.json');
export const RSI = 'https://robertsspaceindustries.com';
const PROBE_URL = `${RSI}/en/account/pledges?page=1&pagesize=1`;

export class NeedLoginError extends Error {
  constructor() {
    super('RSI session missing or expired. Run: npm run login');
  }
}

async function openProfile(headless) {
  return chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless, viewport: null });
}

export async function readSessionFrom(context, page) {
  // Navigation can fail or be interrupted mid-redirect: that means "not
  // determined yet", never "signed in".
  try {
    const res = await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });
    // Apply the shared rule to each <form> opening tag, not to the whole page.
    const formTags = await page.$$eval('form', (fs) => fs.map((f) => f.outerHTML.slice(0, f.outerHTML.indexOf('>') + 1)));
    const loggedIn = /\/account\/pledges/.test(page.url()) && (await page.locator('meta[name="csrf-token"]').count()) > 0
      && !formTags.some(hasSigninForm)
      // Signed out, RSI shows a 200 "Access denied" page at the same address, with a CSRF token.
      && !/^\s*access denied/i.test(await page.title());
    if (!res || !loggedIn) return null;
    const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
    const ua = (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
    const cookies = (await context.cookies(RSI)).filter((c) => neededCookie(c.name)).map(({ name, value, domain, path: p, expires }) => ({ name, value, domain, path: p, expires }));
    if (!cookies.some((c) => c.name === 'Rsi-Token') || !csrf) return null;
    return { savedAt: new Date().toISOString(), userAgent: ua, csrf, cookies };
  } catch {
    return null;
  }
}

function writeSession(session) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.chmodSync(SESSION_FILE, 0o600); // the mode above only applies when the file is created: tighten an older, looser one too
}

/** Refresh session.json from the saved profile without showing a window. */
export async function refreshSession() {
  const context = await openProfile(true);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const session = await readSessionFrom(context, page);
    if (!session) throw new NeedLoginError();
    writeSession(session);
    return session;
  } finally {
    await context.close();
  }
}

/** Visible window: you log in yourself; the session is saved once the hangar loads. */
export async function interactiveLogin() {
  const context = await openProfile(false);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(PROBE_URL).catch(() => {});
    console.log('Log in to RSI in the window (including 2FA). Waiting up to 10 minutes...');
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      if (/\/account\/pledges/.test(page.url()) && (await page.locator('.js-pledge-id').count().catch(() => 0)) > 0) {
        const session = await readSessionFrom(context, page);
        if (session) {
          writeSession(session);
          console.log('Logged in, session saved.');
          return session;
        }
      }
      await page.waitForTimeout(2000);
    }
    throw new Error('Login timed out.');
  } finally {
    await context.close();
  }
}

export function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
}
