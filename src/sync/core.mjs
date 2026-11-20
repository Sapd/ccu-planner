// Shared orchestration. All persistence and network access are supplied by the host.
import { parseHangarPage, parseBuybackPage } from '../parse.mjs';
import { appendSaleHistory, onSaleShipIds, localToday } from '../logic/availability.mjs';
import { recordWarbondPrices } from '../logic/salePrices.mjs';
import { buildPlannerData } from '../logic/mapping.mjs';
import { QUERIES } from './queries.mjs';
import { CATALOG_PATH } from './catalog-query.mjs';
import { fetchItems, assessCatalog, catalogDoc, signedInWarning, shortListings } from './catalog-fetch.mjs';
import { readCatalog } from '../logic/store-catalog.mjs';
import { hasSigninForm } from './signin.mjs';

// RSI's upgrade GraphQL answers at most 5 operations per request ("Maximum subquery limit of 5 reached").
// Requests are spaced 1 s apart by the transport, so sending 5 per request makes the long phases about 5x faster.
export const RSI_MAX_OPS = 5;
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export class SyncCancelled extends Error { constructor() { super('Sync cancelled; progress saved'); } }
export async function sync(cmd, io, options = {}) {
  const { readJson, writeJson, appendLine, log = () => {}, progress = () => {} } = io;
  const join = (...parts) => parts.join('/');
  const flag = (name) => !!options[name];
  const opt = (name, fallback) => options[name] ?? fallback;
  const FULL_SYNC_MAX_AGE_DAYS = 7;
  const clock = () => new Date(options.now?.() ?? Date.now());
  const request = async (...args) => {
    if (options.cancelled?.()) throw new SyncCancelled();
    return io.request(...args);
  };
  const client = {
    // An account page that comes back as RSI's sign-in page is a lost session, not an empty hangar: stop before anything is saved.
    getHtml: async (path) => {
      const html = await request({ method: 'GET', path });
      if (hasSigninForm(html)) throw new Error('RSI session missing or expired: RSI showed its sign-in page instead of your account. Sign in again, then sync.');
      return html;
    },
    upgrade: async (...ops) => {
      const data = await request({ method: 'POST', path: '/pledge-store/api/upgrade/v2/graphql', body: ops.map(({ operationName, variables = {} }) => ({ operationName, variables, query: QUERIES[operationName] })) });
      const errors = data.flatMap((d) => d.errors ?? []);
      if (errors.length) throw new Error(`GraphQL errors: ${JSON.stringify(errors).slice(0, 500)}`);
      if (!Array.isArray(data) || data.length !== ops.length) throw new Error(`RSI answered ${Array.isArray(data) ? data.length : 'no list'} of ${ops.length} queries`);
      return data.map((d) => d.data);
    },
  };
  async function syncCatalog() {
    const [d] = await client.upgrade({ operationName: 'initShipUpgrade' });
    const out = { fetchedAt: new Date().toISOString(), app: d.app, manufacturers: d.manufacturers, ships: d.ships };
    await writeJson(join('catalog.json'), out);
    // Which days each ship was on sale (Standard SKU): availability beyond sale events is learned from this.
    const historyFile = join('sale-history.json');
    await writeJson(historyFile, appendSaleHistory(await readJson(historyFile, { ships: {} }), onSaleShipIds(d.ships), localToday()));
    log(`catalog: ${d.ships.length} ships, currency ${d.app.pricing.currencyCode}`);
    return out;
  }

  async function syncUpgrades() {
    // Every upgrade sync refreshes the catalog (one extra read-only request): that is what records today's on-sale
    // ships in sale-history.json. The upgrade responses only carry upgrade SKUs, not the ships' own Standard SKUs.
    const catalog = await syncCatalog();
    const [all] = await client.upgrade({ operationName: 'filterShips', variables: { fromFilters: [], toFilters: [] } });
    let sources = all.from.ships.map((s) => s.id);
    if (opt('from')) sources = opt('from').split(',').map(Number);
    if (opt('limit')) sources = sources.slice(0, Number(opt('limit')));
    const names = new Map(catalog.ships.map((s) => [s.id, s.name]));
    const { currencyCode, taxRate } = catalog.app.pricing;
    // upgradePrice is in the session's display currency. The exchangeRate scale is
    // not consistent between currencies (EUR 8800 = 0.88, USD 1), so only take
    // USD pre-tax values directly; otherwise use getPrice.nativeAmount per pair.
    const isUsd = currencyCode === 'USD' && !taxRate;
    if (!isUsd) log(`warning: session currency is ${currencyCode}; upgradeUsdCents left empty`);
    const toUsdCents = (v) => (isUsd ? v : null);
    let pairs = 0;
    const events = [];
    const now = clock().toISOString();
    const offerMap = (file) => {
      const m = new Map();
      for (const t of file?.targets ?? []) for (const s of t.skus) if (s.available) m.set(`${t.toId}:${s.id}`, { toId: t.toId, skuId: s.id, cash: s.upgradeUsdCents });
      return m;
    };
    const state = flag('full') ? null : await readJson('sync-state.json', null);
    const key = JSON.stringify(sources);
    const started = new Date(state?.startedAt);
    const age = clock() - started;
    const canResume = state?.key === key && age >= 0 && age < 86400000
      && started.toDateString() === clock().toDateString();
    const resume = canResume ? sources.indexOf(state.lastFinished) + 1 : 0;
    const startedAt = resume ? state.startedAt : now;
    const pendingAppeared = resume ? (state.pendingAppeared ?? []) : [];
    if (resume) {
      const message = `Resuming store sync from ship ${Math.min(resume + 1, sources.length)} of ${sources.length} (started ${started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })})`;
      log(message);
      await progress({ phase: 'upgrades', done: resume, total: sources.length, message });
    }
    let i = resume - 1;
    for (const batch of chunks(sources.slice(resume), RSI_MAX_OPS)) {
      const answers = await client.upgrade(...batch.map((fromId) => ({ operationName: 'filterShips', variables: { fromId, fromFilters: [], toFilters: [] } })));
      for (const [j, fromId] of batch.entries()) {
        i++;
        const d = answers[j];
        const targets = d.to.ships.map((t) => ({
          toId: t.id,
          toName: names.get(t.id) ?? null,
          skus: t.skus.map((s) => ({ ...s, upgradeUsdCents: toUsdCents(s.upgradePrice) })),
        }));
        pairs += targets.length;
        const file = join('upgrades', `${fromId}.json`);
        const next = { fetchedAt: now, fromId, fromName: names.get(fromId) ?? null, pricing: catalog.app.pricing, targets };
        // Offer history: SKUs that appeared, disappeared or changed price since the last sync.
        const eventStart = events.length;
        const prevFile = await readJson(file, null);
        if (prevFile) {
          const before = offerMap(prevFile);
          const after = offerMap(next);
          for (const [k, o] of after) {
            const p = before.get(k);
            if (!p) events.push({ at: now, event: 'appeared', fromId, ...o, since: prevFile.fetchedAt });
            else if (p.cash !== o.cash) events.push({ at: now, event: 'repriced', fromId, ...o, prevCash: p.cash });
          }
          for (const [k, p] of before) if (!after.has(k)) events.push({ at: now, event: 'disappeared', fromId, ...p, lastSeen: prevFile.fetchedAt });
        }
        await writeJson(file, next);
        if (events.length > eventStart) await appendLine('offer-history.jsonl', events.slice(eventStart).map((e) => JSON.stringify(e)).join('\n'));
        pendingAppeared.push(...events.slice(eventStart).filter((e) => e.event === 'appeared'));
        await writeJson('sync-state.json', { key, lastFinished: fromId, startedAt, pendingAppeared });
        await progress({ phase: 'upgrades', done: i + 1, total: sources.length });
        log(`upgrades ${i + 1}/${sources.length}: ${names.get(fromId) ?? fromId} -> ${targets.length} targets`);
      }
    }
    const count = (e) => events.filter((x) => x.event === e).length;
    log(`upgrades: ${sources.length} source ships, ${pairs} pairs · offers appeared ${count('appeared')}, disappeared ${count('disappeared')}, repriced ${count('repriced')}`);

    // New SKUs have no title yet (Standard/Warbond): fetch details for those targets only.
    const known = new Set();
    const details = await readJson(join('ship-details.json'), { details: {} });
    for (const d of Object.values(details.details)) for (const s of d.skus) known.add(s.id);
    // appeared events are produced only for available SKUs. Retain them across resume,
    // rather than scanning every unavailable/historical SKU for missing details.
    const newTargets = [...new Set(pendingAppeared.filter((e) => !known.has(e.skuId)).map((e) => e.toId))];
    if (newTargets.length) await syncDetails(newTargets);

    // Lowest Warbond price seen per pair. Last on purpose: the Warbond/Standard split needs the SKU titles just fetched.
    const priceFile = join('warbond-prices.json');
    const { offers } = buildPlannerData({ catalog, upgrades: await readJson('upgrades', []), details: await readJson('ship-details.json', null) }, {});
    await writeJson(priceFile, recordWarbondPrices(await readJson(priceFile, { pairs: {} }), offers, localToday()));
    await writeJson('sync-state.json', null);
  }

  // Offer details per target ship: SKU titles (Standard/Warbond), limited flag
  // and contained items. The ship's own item ID is how hangar CCUs (which use
  // item IDs) are mapped to upgrade-tool ship IDs without name matching.
  // Pass target ship IDs to refresh only those (merged into the existing file).
  // The item-to-ship mapping itself is derived in src/data.mjs.
  async function syncDetails(only = null) {
    const fromFor = new Map();
    for (const u of await readJson('upgrades', [])) {
      for (const t of u.targets) if (!fromFor.has(t.toId)) fromFor.set(t.toId, u.fromId);
    }
    let targets = only ?? [...fromFor.keys()].sort((a, b) => a - b);
    if (!only && opt('limit')) targets = targets.slice(0, Number(opt('limit')));
    const file = join('ship-details.json');
    const store = only ? await readJson(file, { details: {} }) : { details: {} };
    let i = -1;
    for (const batch of chunks(targets, RSI_MAX_OPS)) {
      const answers = await client.upgrade(...batch.map((id) => ({ operationName: 'getShipDetails', variables: { id, fromShipId: fromFor.get(id) } })));
      for (const [j, id] of batch.entries()) {
        i++;
        const d = answers[j];
        store.details[id] = { probedFrom: fromFor.get(id), fetchedAt: new Date().toISOString(), skus: d.ship?.skus ?? [] };
        await writeJson(file, { fetchedAt: new Date().toISOString(), details: store.details });
        await progress({ phase: 'details', done: i + 1, total: targets.length });
        if ((i + 1) % 20 === 0) log(`details ${i + 1}/${targets.length}`);
      }
    }
    await writeJson(file, { fetchedAt: new Date().toISOString(), details: store.details });
    log(`details: ${targets.length} ship(s) fetched`);
  }

  // The whole RSI store (src/sync/catalog-fetch.mjs): the same pinned browse query as the public sync, sent through the user's session
  // (io.request carries the cookies), which is what makes RSI return the Subscriber store, Concierge items and the account's full listings.
  // Pictures come through the host's io.cacheCatalogImage({ id, thumbUrl }) -> saved name (the desktop app's Rust side); without it only the listing is saved.
  async function syncStoreCatalog() {
    const file = join('store-catalog.json');
    const previous = readCatalog(await readJson(file, null));
    const found = await fetchItems({
      post: (body) => request({ method: 'POST', path: CATALOG_PATH, body }),
      sleep: async () => {}, interval: 0, // the host spaces its requests
      log, cancelled: options.cancelled, progress: (e) => progress(e),
    });
    const doc = catalogDoc(found, { signedIn: true, now: clock().toISOString() });
    const warn = signedInWarning(doc, true);
    if (warn) log(warn);
    assessCatalog(previous, doc); // throws: the saved catalog stays
    const short = shortListings(found.categories);
    if (short.length) log(`warning: RSI delivered fewer store entries than it announced: ${short.join(', ')}`);
    const have = new Set(io.listCatalogImages ? await io.listCatalogImages() : []);
    const old = new Map((previous?.items ?? []).map((i) => [i.id, i]));
    for (const it of found.items) {
      const p = old.get(it.id);
      it.thumb = p?.thumb && p.thumbUrl && p.thumbUrl === it.thumbUrl && have.has(p.thumb) ? p.thumb : null;
    }
    await writeJson(file, doc);
    const todo = io.cacheCatalogImage ? found.items.filter((i) => i.thumbUrl && !i.thumb) : [];
    let failed = 0, streak = 0;
    for (const [n, it] of todo.entries()) {
      if (options.cancelled?.()) throw new SyncCancelled();
      try { it.thumb = await io.cacheCatalogImage({ id: it.id, thumbUrl: it.thumbUrl }); streak = 0; }
      catch (e) {
        if (options.cancelled?.()) throw new SyncCancelled();
        failed++; streak++;
        log(`picture ${it.id} ${it.title}: ${e.message}`);
        if (streak >= 5) { log('warning: store pictures stopped after repeated failures; sync again later'); break; }
      }
      if ((n + 1) % 25 === 0) { await writeJson(file, doc); await progress({ phase: 'store catalog pictures', done: n + 1, total: todo.length }); }
    }
    await writeJson(file, doc);
    log(`store catalog: ${found.items.length} items (${doc.signedIn ? 'signed in' : 'public'}), ${found.items.filter((i) => i.thumb).length} with a picture, ${failed} picture failures, ${found.droppedCount} entries dropped, Subscriber ${found.items.filter((i) => i.subscriber).length}, Concierge ${found.items.filter((i) => i.vip).length}`);
  }

  async function syncPaged({ name, file, urlFor, parse, idOf }) {
    const pagesize = Number(opt('pagesize', 50));
    const store = await readJson(file, { entries: {}, lastFullSync: null, lastSync: null });
    const age = store.lastFullSync ? (Date.now() - Date.parse(store.lastFullSync)) / 86400000 : Infinity;
    const full = flag('full') || age > FULL_SYNC_MAX_AGE_DAYS;
    const seen = new Set();
    const fresh = {};
    let page = 1;
    let complete = false;
    let changed = 0;
    // RSI may ignore the requested pagesize (it returns 10), so the real page
    // size is whatever page 1 returned.
    let pageSize = null;
    for (;;) {
      const rows = parse(await client.getHtml(urlFor(page, pagesize)));
      pageSize ??= rows.length;
      if (rows.length > 0 && rows.every((r) => seen.has(idOf(r)))) { complete = true; break; } // RSI repeats the last page
      let unchangedOnPage = 0;
      for (const r of rows) {
        const id = idOf(r);
        seen.add(id);
        const prev = store.entries[id];
        if (prev && JSON.stringify(prev.data) === JSON.stringify(r)) unchangedOnPage++;
        else changed++;
        fresh[id] = { data: r, firstSeen: prev?.firstSeen ?? new Date().toISOString(), lastSeen: new Date().toISOString() };
      }
      await progress({ phase: name, done: page, total: null });
      log(`${name} page ${page}: ${rows.length} entries, ${rows.length - unchangedOnPage} new/changed`);
      if (rows.length === 0 || rows.length < pageSize) { complete = true; break; }
      if (!full && rows.length > 0 && unchangedOnPage === rows.length) break; // rest is cached
      page++;
    }
    if (full && complete) {
      const active = Object.values(store.entries).filter((e) => !e.goneSince).length;
      if (name === 'hangar' && active >= 10 && seen.size < active / 2 && !flag('force')) {
        const message = `RSI returned ${seen.size} of ${active} pledges. Overwrite anyway?`;
        const accepted = await io.confirmOverwrite?.({ current: seen.size, previous: active, message });
        if (!accepted && options.cancelled?.()) throw new SyncCancelled();
        if (!accepted) throw new Error(`RSI returned an unusually small hangar; nothing was changed (${seen.size} of ${active} pledges; use --force to overwrite)`);
      }
      // Authoritative snapshot: anything not seen is gone (applied, melted, gifted or bought back).
      const gone = Object.keys(store.entries).filter((id) => !seen.has(id));
      for (const id of gone) store.entries[id].goneSince ??= new Date().toISOString();
      for (const [id, v] of Object.entries(fresh)) store.entries[id] = v;
      store.entries = Object.fromEntries(Object.entries(store.entries).filter(([id, v]) => seen.has(id) || v.goneSince));
      store.lastFullSync = new Date().toISOString();
      log(`${name}: full sync, ${seen.size} current, ${gone.length} disappeared`);
    } else {
      for (const [id, v] of Object.entries(fresh)) store.entries[id] = v;
      log(`${name}: incremental sync, ${changed} new/changed, ${page} page(s) read`);
    }
    if (name === 'hangar' && seen.size === 0 && page === 1) log('warning: RSI listed no pledges in your hangar. If you have pledges, sign in to RSI again and sync the hangar');
    store.lastSync = new Date().toISOString();
    await writeJson(file, store);
  }

  switch (cmd) {
    case 'catalog': await syncCatalog(); break;
    case 'upgrades': await syncUpgrades(); break;
    case 'store-catalog': await syncStoreCatalog(); break;
    case 'hangar':
      await syncPaged({
        name: 'hangar', file: join('hangar.json'),
        urlFor: (p, s) => `/en/account/pledges?page=${p}&pagesize=${s}`,
        parse: parseHangarPage, idOf: (r) => String(r.pledgeId),
      });
      break;
    case 'buyback':
      await syncPaged({
        name: 'buyback', file: join('buyback.json'),
        urlFor: (p, s) => `/en/account/buy-back-pledges?page=${p}&pagesize=${s}`,
        parse: parseBuybackPage, idOf: (r) => String(r.buybackPledgeId ?? r.name),
      });
      break;
    case 'details': await syncDetails(); break;
    default:
      log('usage: sync.mjs catalog | store-catalog | upgrades [--limit N] [--from ids] | details | hangar [--full] [--force] | buyback [--full]');
      throw Object.assign(new Error('unknown sync command'), { exitCode: 2 });
  }

}
