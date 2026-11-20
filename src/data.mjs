// Node file loader for the planner data. Reads a data directory (default
// the Tauri app data folder, or the CCU_DATA environment variable) and hands the raw
// JSON to the pure logic in src/logic/. Nothing here may be needed by the app.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildPlannerData } from './logic/mapping.mjs';
import { emptyOverrides } from './logic/prices.mjs';
import { newState } from './logic/chains.mjs';
import { emptySaleEvents } from './logic/availability.mjs';
import { buildGraph } from './logic/planner.mjs';
import { expectedOffers } from './logic/prices.mjs';
import { createSession, planningGraph } from './logic/session.mjs';
import { setPricing } from './logic/format.mjs';
import { withSnapshot } from './logic/changes.mjs';
import { IDENTIFIER, migrateDefault } from './data-migrate.mjs';
import { withWriteLock } from './sync/write-lock.mjs';
import { mergeSaleEvents } from './logic/feed.mjs';
import { loadFeedEvents } from './feed.mjs';

export { norm, findShip } from './logic/ships.mjs';
export { expectedMsrp, expectedOffers } from './logic/prices.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Tauri PathResolver::app_data_dir uses dirs::data_dir()/identifier.
export function appDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  const p = platform === 'win32' ? path.win32 : path.posix; // the target platform's separators, whatever runs this
  const base = platform === 'darwin' ? p.join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.APPDATA || p.join(home, 'AppData', 'Roaming'))
      : (env.XDG_DATA_HOME || p.join(home, '.local', 'share'));
  return p.join(base, IDENTIFIER, 'data');
}
export const DATA_DIR = process.env.CCU_DATA ? path.resolve(process.env.CCU_DATA) : appDataDir();
let migrated = false;
/**
 * Moves data from the old identifier's folder once per process, before anything reads or creates the default folder.
 * Never touches an explicit CCU_DATA folder. Call it before any mkdir of DATA_DIR.
 */
export function ensureDefaultDataDir() {
  if (migrated || process.env.CCU_DATA) return;
  migrated = true;
  migrateDefault(path.dirname(DATA_DIR));
}
export function checkLegacyData() {
  ensureDefaultDataDir();
  const old = path.join(REPO_ROOT, '.local', 'data');
  if (!process.env.CCU_DATA && !fs.existsSync(DATA_DIR) && fs.existsSync(old)) {
    throw new Error(`Old planner data found. Move ${old} to ${DATA_DIR} before continuing, or set CCU_DATA to your existing folder. No files were moved.`);
  }
}

const ALIASES = JSON.parse(fs.readFileSync(new URL('./logic/aliases.json', import.meta.url), 'utf8'));

/** plan-snapshots.json as stored, or null when absent or unreadable: a damaged file only means no history (it is warned about). */
function readSnapshotsDoc(f) {
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.warn(`warning: ignoring unreadable ${path.basename(f)}: ${e.message}`);
    return null;
  }
}

/** Reads every planner input from a data directory. Optional files are null when absent. */
export function readRaw(dir = DATA_DIR) {
  if (dir === DATA_DIR) checkLegacyData();
  const file = (f) => path.join(dir, f);
  const read = (f) => JSON.parse(fs.readFileSync(file(f), 'utf8'));
  const optional = (f) => (fs.existsSync(file(f)) ? read(f) : null);
  const upgradesDir = file('upgrades');
  const upgrades = fs.existsSync(upgradesDir) ? fs.readdirSync(upgradesDir).filter((f) => f.endsWith('.json') && fs.lstatSync(path.join(upgradesDir, f)).isFile()).sort().map((f) => read(path.join('upgrades', f))) : [];
  const history = fs.existsSync(file('offer-history.jsonl')) ? fs.readFileSync(file('offer-history.jsonl'), 'utf8') : '';
  return {
    catalog: read('catalog.json'),
    details: optional('ship-details.json'),
    upgrades,
    hangar: optional('hangar.json'),
    buyback: optional('buyback.json'),
    history,
    plans: optional('plans.json'),
    overrides: optional('price-overrides.json'),
    images: optional('ship-images.json'),
    saleHistory: optional('sale-history.json'),
    saleEvents: optional('sale-events.json'),
    warbondPrices: optional('warbond-prices.json') ?? { pairs: {} },
    planSnapshots: readSnapshotsDoc(file('plan-snapshots.json')),
  };
}

export function loadPlannerData(dir = DATA_DIR) {
  const data = buildPlannerData(readRaw(dir), ALIASES);
  setPricing(data.pricing);
  return data;
}

// Price overrides: your assumption that a ship's price will change (e.g. an
// announced increase). Stored apart from RSI data in price-overrides.json and
// never written into the synced catalog.

const overridesPath = (dir = DATA_DIR) => path.join(dir, 'price-overrides.json');

/** Overrides as stored; a file without rev is read as rev 0. */
export function loadOverrides(dir = DATA_DIR) {
  const f = overridesPath(dir);
  if (!fs.existsSync(f)) return emptyOverrides();
  const o = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { ...o, rev: o.rev ?? 0, ships: o.ships ?? {} };
}

/** A temp name no other process or write shares (pid and a random suffix). */
export const tmpName = (file) => `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

/**
 * Writes a document at rev + 1, unless the file on disk has moved past the rev
 * the document was loaded at. Returns false and writes nothing in that case.
 */
function saveRevisioned(file, doc) {
  if (path.dirname(file) === DATA_DIR) ensureDefaultDataDir();
  // The check, the write and the rename are one step across processes (a second writer with the same base revision must fail).
  return withWriteLock(path.dirname(file), () => saveRevisionedLocked(file, doc));
}

function saveRevisionedLocked(file, doc) {
  const onDisk = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).rev ?? 0) : 0;
  const loaded = doc.rev ?? 0;
  if (onDisk !== loaded) return false;
  const tmp = tmpName(file);
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...doc, rev: loaded + 1 }, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return true;
}

export function saveOverrides(o, dir = DATA_DIR) {
  return saveRevisioned(overridesPath(dir), o);
}

// Plans: the chains state (plans.json). Same rev rule as the overrides.

const plansPath = (dir = DATA_DIR) => path.join(dir, 'plans.json');

/** Plans as stored; an absent file is the empty state at rev 0. */
export function loadPlans(dir = DATA_DIR) {
  const f = plansPath(dir);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : newState();
}

export function savePlans(state, dir = DATA_DIR) {
  return saveRevisioned(plansPath(dir), state);
}

// Sale events: the sale windows you maintain (sale-events.json). Same rev rule.

const saleEventsPath = (dir = DATA_DIR) => path.join(dir, 'sale-events.json');

/** Sale events as stored; an absent file is the empty document at rev 0. */
export function loadSaleEvents(dir = DATA_DIR) {
  const f = saleEventsPath(dir);
  if (!fs.existsSync(f)) return emptySaleEvents();
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { ...d, rev: d.rev ?? 0, events: d.events ?? [] };
}

export function saveSaleEvents(doc, dir = DATA_DIR) {
  return saveRevisioned(saleEventsPath(dir), doc);
}

/** Your sale events plus the verified feed cache's (<dir>/feed/), as the planner uses them. Never save this: it holds the feed's events too. */
export function loadPlanningSaleEvents(dir = DATA_DIR) {
  const feed = loadFeedEvents(dir);
  return mergeSaleEvents(loadSaleEvents(dir), feed.events, feed.at);
}

// Plan snapshots (plan-snapshots.json): the shared plan after every sync, so the app can say what changed.
// Written by scripts/sync.mjs only; the app reads it and never saves it. Not a revisioned document.

const snapshotsPath = (dir = DATA_DIR) => path.join(dir, 'plan-snapshots.json');

/** The stored snapshots, oldest first; [] when the file is absent. */
export function loadSnapshots(dir = DATA_DIR) {
  const doc = readSnapshotsDoc(snapshotsPath(dir));
  return Array.isArray(doc?.snapshots) ? doc.snapshots : [];
}

export function saveSnapshots(snapshots, dir = DATA_DIR) {
  const f = snapshotsPath(dir);
  if (dir === DATA_DIR) ensureDefaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = tmpName(f);
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, snapshots }));
    fs.renameSync(tmp, f);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** A planning session of a data directory, built the way scripts/chain.mjs builds its own. */
export function loadSession(dir = DATA_DIR) {
  const data = loadPlannerData(dir);
  const overrides = loadOverrides(dir);
  const plans = loadPlans(dir);
  return createSession({
    plans, graph: planningGraph(buildGraph(data), plans), data, overrides, saleEvents: loadPlanningSaleEvents(dir),
    expected: expectedOffers(data.offers, data.ships, overrides),
  });
}

/**
 * Stores a snapshot of the session's plan, replacing one of the same data (store, hangar and offers stamps) so the latest wins.
 * Nothing is built or written when the newest snapshot already has these stamps and the same plan, price and sale-event
 * revisions (a `details` or `buyback` sync). Keeps the newest 30. Returns true when one was written.
 */
export function recordSnapshot(session, dir = DATA_DIR, at = new Date().toISOString()) {
  const list = loadSnapshots(dir);
  const next = withSnapshot(list, session, at);
  if (!next) return false;
  saveSnapshots(next, dir);
  return true;
}
