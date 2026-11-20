// The Node side of the MCP tools: the data folder, the revisioned saves and the read-only RSI sync. Mirrors scripts/sync.mjs
// (same RsiClient, same shared sync core, same plan snapshots around a sync). Nothing here writes to stdout: stdout is the protocol.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, tmpName, checkLegacyData, loadPlannerData, loadPlans, loadOverrides, loadSaleEvents, loadSnapshots, savePlans, saveOverrides, saveSaleEvents, loadSession, recordSnapshot } from '../data.mjs';
import { loadFeedEvents } from '../feed.mjs';
import { buildGraph } from '../logic/planner.mjs';
import { withDocs } from '../../app/src/lib/view/derive.mjs';
import { appendLines } from '../sync/append-lines.mjs';
import { sync } from '../sync/core.mjs';
import { acquireSyncLock } from '../sync/lock.mjs';
import { currencyProblem } from '../logic/format.mjs';
import { ToolError } from './tools.mjs';

const ALIASES = JSON.parse(fs.readFileSync(new URL('../logic/aliases.json', import.meta.url), 'utf8'));

export const NO_PLAYWRIGHT = 'Syncing needs the playwright package, which is not installed here (it is a dev dependency of the planner). Run npm install in the planner folder, or sync from the app or the CLI.';

// rsi.mjs and session.mjs import playwright, so they are loaded only when a sync really runs: the read-only tools start without it.
const defaultLoadRsi = async () => ({ ...(await import('../rsi.mjs')), ...(await import('../session.mjs')) });

/** @param {{ dir?: string, loadRsi?: () => Promise<{ RsiClient: Function, SESSION_FILE: string }>, sessionExists?: (SESSION_FILE: string) => boolean }} options */
export function createNodeDeps({ dir = DATA_DIR, loadRsi = defaultLoadRsi, sessionExists = (f) => fs.existsSync(f) } = {}) {
  const loadRsiOrExplain = async () => {
    try { return await loadRsi(); } catch (e) {
      if (e?.code === 'ERR_MODULE_NOT_FOUND' && /playwright/i.test(e?.message ?? '')) throw Object.assign(new Error(NO_PLAYWRIGHT), { clear: true });
      throw e;
    }
  };
  const file = (name) => path.join(dir, name);
  const readJson = (name, fallback) => {
    if (name === 'upgrades') return fs.existsSync(file(name)) ? fs.readdirSync(file(name)).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(`upgrades/${f}`)) : [];
    return fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), 'utf8')) : fallback;
  };
  const savers = { plans: savePlans, overrides: saveOverrides, 'sale-events': saveSaleEvents };
  // Plan snapshots feed the "since last sync" answer. A failure here never fails the sync.
  const snapshotPlan = (when, log) => {
    try {
      if (fs.existsSync(file('catalog.json')) && recordSnapshot(loadSession(dir), dir)) log(`plan snapshot recorded (${when})`);
    } catch (e) {
      log(`warning: no plan snapshot ${when}: ${e.message}`);
    }
  };
  return {
    allowWrites: false,
    aliases: ALIASES,
    now: () => new Date(),
    load() {
      if (dir === DATA_DIR) checkLegacyData();
      const data = loadPlannerData(dir);
      // Every tool, the writing ones too, goes through here: a non-USD account is refused like in the app and the chain CLI.
      const wrongCurrency = currencyProblem(data.pricing);
      if (wrongCurrency) throw new ToolError(wrongCurrency);
      return withDocs({ data, graph: buildGraph(data) }, loadPlans(dir), loadOverrides(dir), loadSaleEvents(dir), loadFeedEvents(dir));
    },
    snapshots: () => loadSnapshots(dir),
    save: (name, doc) => {
      if (!savers[name]) throw new Error(`unknown document ${name}`);
      return savers[name](doc, dir);
    },
    // Only an absolute .json file outside the data folder and any .local folder; the resolved path is what is checked.
    readFile(p, maxBytes) {
      if (!path.isAbsolute(p)) throw new Error('refused');
      // Native real paths (the on-disk spelling), compared case-insensitively where the file system is (macOS, Windows).
      const fold = process.platform === 'darwin' || process.platform === 'win32' ? (x) => x.toLowerCase() : (x) => x;
      const real = fs.realpathSync.native(p);
      const rel = path.relative(fold(fs.realpathSync.native(dir)), fold(real));
      const inData = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
      if (inData || fold(real).split(path.sep).includes('.local') || !/\.json$/i.test(real)) throw new Error('refused');
      const st = fs.statSync(real);
      if (!st.isFile() || st.size > maxBytes) throw new Error('refused');
      return fs.readFileSync(real, 'utf8');
    },
    sync: {
      // Only whether a session file exists is checked; its content (cookies) is never read here or returned.
      async available() {
        const { SESSION_FILE } = await loadRsiOrExplain();
        return sessionExists(SESSION_FILE);
      },
      async run(cmd, options, { onProgress, signal } = {}) {
        const { RsiClient } = await loadRsiOrExplain();
        const release = acquireSyncLock(dir); // throws SyncBusyError while the CLI, the dev server or another MCP server syncs
        try {
          const log = (m) => console.error(`[sync] ${m}`);
          const cancelled = () => !!signal?.aborted;
          const client = new RsiClient({ cancelled, minIntervalMs: 1000, log: (m) => log(`  ${m}`) });
          const started = Date.now();
          checkLegacyData();
          snapshotPlan('before this sync', log);
          await client.init();
          if (cancelled()) throw new Error('Sync cancelled; progress saved');
          await sync(cmd, {
            request: async ({ method, path: url, body }) => {
              if (method === 'GET') return client.getHtml(url);
              await client.ensureUpgradeContext();
              if (cancelled()) throw new Error('Sync cancelled; progress saved');
              return (await client.request(url, { method, json: body, headers: { 'x-csrf-token': client.session.csrf } })).json();
            },
            readJson,
            writeJson: (name, value) => {
              fs.mkdirSync(path.dirname(file(name)), { recursive: true });
              const tmp = tmpName(file(name));
              try {
                fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
                fs.renameSync(tmp, file(name));
              } catch (e) {
                fs.rmSync(tmp, { force: true });
                throw e;
              }
            },
            appendLine: (name, line) => appendLines(file(name), line),
            log,
            progress: (event) => onProgress?.(event),
          }, { ...options, cancelled });
          snapshotPlan('after this sync', log);
          return { requests: client.requests, seconds: (Date.now() - started) / 1000 };
        } finally {
          release();
        }
      },
    },
  };
}
