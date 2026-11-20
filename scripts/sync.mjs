// Node host for the shared, read-only sync core.
import fs from 'node:fs';
import path from 'node:path';
import { RsiClient } from '../src/rsi.mjs';
import { readCapped, MAX_LISTING_BYTES } from '../src/image-sync.mjs';
import { DATA_DIR, tmpName, checkLegacyData, loadSession, recordSnapshot } from '../src/data.mjs';
import { appendLines } from '../src/sync/append-lines.mjs';
import { cliControl } from '../src/sync/cli-control.mjs';
import { sync } from '../src/sync/core.mjs';
import { acquireSyncLock } from '../src/sync/lock.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 1; i < args.length; i++) {
  if (!args[i].startsWith('--')) continue;
  const key = args[i].slice(2);
  options[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
}
const control = cliControl();
options.cancelled = control.cancelled;
// --interval can slow the sync down but never below one request a second.
const client = new RsiClient({ cancelled: control.cancelled, minIntervalMs: Math.max(1000, Number(options.interval) || 1000), log: (m) => console.log('  ' + m) });
const started = Date.now();
let releaseLock = () => {};
const file = (name) => path.join(DATA_DIR, name);
const readJson = (name, fallback) => {
  if (name === 'upgrades') return fs.existsSync(file(name)) ? fs.readdirSync(file(name)).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(`upgrades/${f}`)) : [];
  return fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), 'utf8')) : fallback;
};
// Plan snapshots feed the app's "since last sync" panel. A failure here never fails the sync.
function snapshotPlan(when) {
  try {
    if (!fs.existsSync(file('catalog.json'))) return;
    if (recordSnapshot(loadSession(DATA_DIR), DATA_DIR)) console.log(`plan snapshot recorded (${when})`);
  } catch (e) {
    console.warn(`warning: no plan snapshot ${when}: ${e.message}`);
  }
}
try {
  if (!['catalog', 'store-catalog', 'upgrades', 'details', 'hangar', 'buyback'].includes(args[0])) {
    throw Object.assign(new Error('usage: sync.mjs catalog | store-catalog | upgrades | details | hangar [--full] [--force] | buyback [--full]'), { exitCode: 2 });
  }
  checkLegacyData();
  releaseLock = acquireSyncLock(DATA_DIR); // one sync at a time per data folder (CLI, dev server child, MCP server)
  snapshotPlan('before this sync');
  await client.init();
  await sync(args[0], {
    request: async ({ method, path: url, body }) => {
      if (method === 'GET') return client.getHtml(url);
      if (url !== '/graphql') await client.ensureUpgradeContext(); // the store catalog query needs no upgrade context
      if (control.cancelled()) throw new Error('Sync cancelled; progress saved');
      const res = await client.request(url, { method, json: body, headers: { 'x-csrf-token': client.session.csrf } });
      return url === '/graphql' ? JSON.parse((await readCapped(res, MAX_LISTING_BYTES, 'listing')).toString('utf8')) : res.json();
    },
    readJson,
    confirmOverwrite: control.confirmOverwrite,
    writeJson: (name, value) => {
      fs.mkdirSync(path.dirname(file(name)), { recursive: true });
      const tmp = tmpName(file(name)); // unique per write, like the MCP server's sync
      try {
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
        fs.renameSync(tmp, file(name));
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
    },
    appendLine: (name, line) => appendLines(file(name), line),
    log: console.log,
    progress: (event) => console.log(`progress ${JSON.stringify(event)}`),
  }, options);
  snapshotPlan('after this sync');
  console.log(`${client.requests} request(s), ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (e) { console.error(e.message); process.exitCode = control.cancelled() ? 130 : e.exitCode ?? 1; }
finally { releaseLock(); control.close(); }
