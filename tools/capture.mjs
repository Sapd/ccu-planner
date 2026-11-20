// Records the requests the RSI website makes while you browse it, so we can
// find the endpoints for hangar, buy-back and the upgrade tool.
//
// - Opens your installed Chrome with its own profile in .local/profile.
//   You log in yourself; no password is stored or read by this script.
// - Records fetch/XHR/document requests to robertsspaceindustries.com into
//   .local/capture/<run>/requests.jsonl, response bodies into bodies/.
// - Secrets are masked: cookie/token/csrf/auth headers, login request bodies,
//   token-like JSON fields and csrf meta tags.
// - Navigation helper: write an RSI URL into .local/control/goto and the
//   window opens it (GET only, robertsspaceindustries.com only).
// - Ends when you close the browser window.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(root, '.local', 'capture', runId);
const bodyDir = path.join(outDir, 'bodies');
const controlFile = path.join(root, '.local', 'control', 'goto');
fs.mkdirSync(bodyDir, { recursive: true });
fs.mkdirSync(path.dirname(controlFile), { recursive: true });
const log = fs.createWriteStream(path.join(outDir, 'requests.jsonl'), { flags: 'a' });

const RSI_HOST = /(^|\.)robertsspaceindustries\.com$/i;
const SECRET_HEADER = /cookie|token|csrf|xsrf|auth|session|signature/i;
const SECRET_KEY = /token|csrf|xsrf|password|secret|session|auth/i;
const AUTH_URL = /sign-?in|log-?in|auth|password|two-?factor|2fa|mfa|captcha|recaptcha/i;
const KEEP_TYPES = new Set(['xhr', 'fetch', 'document']);
const MAX_BODY = 8 * 1024 * 1024;

const maskHeaders = (h) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k, SECRET_HEADER.test(k) ? '[masked]' : v]));

function maskJson(value) {
  if (Array.isArray(value)) return value.map(maskJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) && typeof v === 'string' ? '[masked]' : maskJson(v)]),
    );
  }
  return value;
}

function maskText(text, contentType) {
  if (/json/i.test(contentType)) {
    try { return JSON.stringify(maskJson(JSON.parse(text)), null, 2); } catch { /* fall through */ }
  }
  return text
    .replace(/(<meta[^>]+name=["'][^"']*(csrf|token)[^"']*["'][^>]+content=)["'][^"']*["']/gi, '$1"[masked]"')
    .replace(/(["']?(?:csrf|token|rsi-token|xsrf)[\w-]*["']?\s*[:=]\s*)["'][^"']{12,}["']/gi, '$1"[masked]"')
    .replace(/(&quot;(?:token|csrf\w*|xsrf\w*)&quot;:&quot;)[^&]{8,}(&quot;)/gi, '$1[masked]$2');
}

let seq = 0;
async function record(request, failure) {
  let url;
  try { url = new URL(request.url()); } catch { return; }
  if (!RSI_HOST.test(url.hostname) || !KEEP_TYPES.has(request.resourceType())) return;
  const n = String(++seq).padStart(4, '0');
  const isAuth = AUTH_URL.test(url.pathname);
  const entry = {
    n,
    time: new Date().toISOString(),
    method: request.method(),
    url: url.toString(),
    type: request.resourceType(),
    requestHeaders: maskHeaders(await request.allHeaders().catch(() => request.headers())),
    postData: null,
    status: null,
    responseHeaders: null,
    body: null,
    failure: failure ?? null,
  };
  const post = request.postData();
  if (post) {
    const ct = entry.requestHeaders['content-type'] ?? '';
    entry.postData = isAuth || /password/i.test(post) ? '[masked: auth request]' : maskText(post, ct);
  }
  const response = failure ? null : await request.response().catch(() => null);
  if (response) {
    entry.status = response.status();
    const rh = await response.allHeaders().catch(() => response.headers());
    entry.responseHeaders = maskHeaders(rh);
    const ct = rh['content-type'] ?? '';
    if (!isAuth && /json|html|text|javascript|graphql/i.test(ct)) {
      try {
        const buf = await response.body();
        if (buf.length <= MAX_BODY) {
          const ext = /json/i.test(ct) ? 'json' : /html/i.test(ct) ? 'html' : 'txt';
          const file = `${n}.${ext}`;
          fs.writeFileSync(path.join(bodyDir, file), maskText(buf.toString('utf8'), ct));
          entry.body = { file, bytes: buf.length, contentType: ct };
        } else {
          entry.body = { skipped: `too large (${buf.length} bytes)`, contentType: ct };
        }
      } catch (e) {
        entry.body = { skipped: String(e.message ?? e).slice(0, 200) };
      }
    }
  }
  log.write(JSON.stringify(entry) + '\n');
  console.log(`${n} ${entry.method} ${entry.status ?? 'ERR'} ${url.pathname}${url.search}`);
}

const context = await chromium.launchPersistentContext(path.join(root, '.local', 'profile'), {
  channel: 'chrome',
  headless: false,
  viewport: null,
});
context.on('requestfinished', (r) => record(r).catch((e) => console.error('record error', e.message)));
context.on('requestfailed', (r) => record(r, r.failure()?.errorText ?? 'failed').catch(() => {}));

const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://robertsspaceindustries.com/account/pledges').catch(() => {});

const timer = setInterval(async () => {
  if (!fs.existsSync(controlFile)) return;
  const target = fs.readFileSync(controlFile, 'utf8').trim();
  fs.rmSync(controlFile, { force: true });
  try {
    const u = new URL(target);
    if (u.protocol !== 'https:' || !RSI_HOST.test(u.hostname)) throw new Error('not an RSI https URL');
    const p = context.pages().at(-1) ?? page;
    console.log(`goto ${u}`);
    await p.goto(u.toString(), { waitUntil: 'domcontentloaded' });
  } catch (e) {
    console.error(`goto refused: ${e.message}`);
  }
}, 1000);

console.log(`Capturing into ${outDir}\nLog in in the Chrome window. Close the window to finish.`);
await new Promise((resolve) => context.on('close', resolve));
clearInterval(timer);
log.end();
console.log(`Done. ${seq} requests recorded in ${outDir}`);
