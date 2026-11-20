// Direct, read-only RSI client over plain HTTP using the saved session.
// Guard rails: only GET on an allowlisted set of pages, and POST only to the
// upgrade context endpoint and allowlisted GraphQL *queries* (no mutations).

import { isSignedInPage } from './sync/signin.mjs';
import { loadSession, refreshSession, NeedLoginError, RSI } from './session.mjs';

const UPGRADE_GQL = '/pledge-store/api/upgrade/v2/graphql';
const ALLOWED_GET = [/^\/en\/account\/pledges\?/, /^\/en\/account\/buy-back-pledges\?/];
const ALLOWED_OPS = new Set(['initShipUpgrade', 'filterShips', 'getPrice', 'getShipDetails']);

export { QUERIES } from './sync/queries.mjs';
import { QUERIES } from './sync/queries.mjs';
import { validateRequest } from './sync/policy.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RsiClient {
  constructor({ minIntervalMs = 1000, log = () => {}, cancelled = () => false } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.cancelled = cancelled;
    this.log = log;
    this.lastRequest = 0;
    this.session = null;
    this.jar = new Map();
    this.upgradeContextReady = false;
    this.requests = 0;
  }

  async init({ refresh = false } = {}) {
    this.session = (!refresh && loadSession()) || (await refreshSession());
    this.jar = new Map(this.session.cookies.map((c) => [c.name, c.value]));
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorbCookies(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async request(pathAndQuery, { method = 'GET', json, headers = {}, referer = '/en/account/pledges?page=1&pagesize=10', retried = false, confirming = false, csrfRetried = false } = {}) {
    validateRequest(method, pathAndQuery, json);
    if (this.cancelled()) throw new Error('Sync cancelled; progress saved');
    const wait = this.lastRequest + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    if (this.cancelled()) throw new Error('Sync cancelled; progress saved');
    this.lastRequest = Date.now();
    this.requests++;
    const res = await fetch(RSI + pathAndQuery, {
      method,
      redirect: 'manual',
      headers: {
        'user-agent': this.session.userAgent,
        accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        origin: RSI,
        referer: RSI + referer,
        cookie: this.cookieHeader(),
        ...(json ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: json ? JSON.stringify(json) : undefined,
    });
    this.absorbCookies(res);
    this.log(`${method} ${res.status} ${pathAndQuery.split('?')[0]}`);

    if (confirming) return res;
    let forbiddenExpired = false;
    if (res.status === 403) {
      const previousCsrf = this.session.csrf;
      let refreshed = false;
      try {
        const probe = await this.request('/en/account/pledges?page=1&pagesize=1', { confirming: true });
        if (probe.ok) {
          const html = await probe.text();
          const csrf = html.match(/<meta name="csrf-token" content="([^"]+)"/);
          if (csrf && isSignedInPage(html)) {
            this.session.csrf = csrf[1];
            refreshed = this.session.csrf !== previousCsrf;
          }
        }
        forbiddenExpired = probe.status >= 300 && probe.status < 400 && /sign-?in|login/i.test(probe.headers.get('location') ?? '');
      } catch { /* an unsuccessful probe does not prove expiry */ }
      if (!forbiddenExpired) {
        if (refreshed && !csrfRetried) {
          const nextHeaders = pathAndQuery === UPGRADE_GQL || Object.hasOwn(headers, 'x-csrf-token')
            ? { ...headers, 'x-csrf-token': this.session.csrf } : headers;
          return this.request(pathAndQuery, { method, json, headers: nextHeaders, referer, retried, csrfRetried: true });
        }
        throw new Error('RSI refused the request (403)');
      }
    }
    // A 401 on the store browse query alone is a catalog failure, not proof that the hangar session ran out.
    if (res.status === 401 && method === 'POST' && pathAndQuery === '/graphql') throw new Error('RSI refused the store catalog request (401)');
    const expired = res.status === 401 || forbiddenExpired
      || (res.status >= 300 && res.status < 400 && /sign-?in|login/i.test(res.headers.get('location') ?? ''));
    if (expired && !retried) {
      if (this.cancelled()) throw new Error('Sync cancelled; progress saved');
      this.log('session looks expired, refreshing from profile');
      await this.init({ refresh: true });
      if (this.cancelled()) throw new Error('Sync cancelled; progress saved');
      this.upgradeContextReady = false;
      return this.request(pathAndQuery, { method, json, headers, referer, retried: true, csrfRetried });
    }
    if (expired) throw new NeedLoginError();
    if (res.status === 429 && !retried) {
      if (this.cancelled()) throw new Error('Sync cancelled; progress saved');
      const after = Number(res.headers.get('retry-after')) || 30;
      this.log(`rate limited, waiting ${after}s`);
      await sleep(after * 1000);
      return this.request(pathAndQuery, { method, json, headers, referer, retried: true, csrfRetried });
    }
    if (!res.ok) throw new Error(`RSI ${method} ${pathAndQuery} -> HTTP ${res.status}`);
    return res;
  }

  async getHtml(pathAndQuery) {
    if (!ALLOWED_GET.some((re) => re.test(pathAndQuery))) throw new Error(`GET not allowlisted: ${pathAndQuery}`);
    const res = await this.request(pathAndQuery);
    const html = await res.text();
    // Keep the CSRF token current; RSI rotates it.
    const m = html.match(/<meta name="csrf-token" content="([^"]+)"/);
    if (m) this.session.csrf = m[1];
    return html;
  }

  async ensureUpgradeContext() {
    if (this.upgradeContextReady) return;
    await this.request('/api/ship-upgrades/setContextToken', {
      method: 'POST',
      json: { fromShipId: null, toShipId: null, toSkuId: null, pledgeId: null },
      headers: { 'x-rsi-token': this.jar.get('Rsi-Token') ?? '' },
    });
    this.upgradeContextReady = true;
  }

  /** Runs allowlisted upgrade-tool queries (batched like the website does). */
  async upgrade(...ops) {
    for (const { operationName } of ops) {
      if (!ALLOWED_OPS.has(operationName)) throw new Error(`operation not allowlisted: ${operationName}`);
    }
    await this.ensureUpgradeContext();
    const body = ops.map(({ operationName, variables = {} }) => ({ operationName, variables, query: QUERIES[operationName] }));
    if (body.some((b) => /\bmutation\b/.test(b.query))) throw new Error('mutations are not allowed');
    const res = await this.request(UPGRADE_GQL, { method: 'POST', json: body, headers: { 'x-csrf-token': this.session.csrf } });
    const data = await res.json();
    const errors = data.flatMap((d) => d.errors ?? []);
    if (errors.length) throw new Error(`GraphQL errors: ${JSON.stringify(errors).slice(0, 500)}`);
    return data.map((d) => d.data);
  }
}
