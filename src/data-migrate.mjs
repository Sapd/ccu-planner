// One-time move of the app data folder from the old bundle identifier to the new one.
// The rule is shared with app/src-tauri/src/migrate.rs and must stay identical:
// a folder "has planner data" when its data/ folder holds one of the app's own files
// (WebKit, cache or OS files do not count). Old has data and new has none: move the old
// entries over (merge, never overwrite). Both have data: move nothing, use the new one,
// and warn once (the note file keeps it to one time). Otherwise nothing happens.
import fs from 'node:fs';
import path from 'node:path';

export const LEGACY_IDENTIFIER = 'com.ccuplanner.desktop';
export const IDENTIFIER = 'eu.sapd.ccuplanner';
export const MIGRATING = '.migrating';
export const WARNED = '.legacy-warned';
export const PLANNER_FILES = [
  'catalog.json', 'ship-details.json', 'hangar.json', 'buyback.json', 'plans.json', 'price-overrides.json',
  'ship-images.json', 'offer-history.jsonl', 'sale-history.json', 'sale-events.json', 'warbond-prices.json',
  'plan-snapshots.json',
];

export function hasPlannerData(appDir) {
  const data = path.join(appDir, 'data');
  return PLANNER_FILES.some((f) => { try { return fs.statSync(path.join(data, f)).isFile(); } catch { return false; } });
}

export function bothNote(oldDir, newDir) {
  return `CCU Planner found planner data in two places and moved nothing.\n  Using:    ${newDir}\n  Not used: ${oldDir}\n`
    + 'If the old folder holds the data you want, close the app, move its `data` folder over the new one, and start again.\n';
}

const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

function moveEntry(src, dst) {
  try { fs.renameSync(src, dst); return; } catch { /* other volume: copy */ }
  const staging = `${dst}.moving`;
  fs.rmSync(staging, { recursive: true, force: true });
  try { fs.cpSync(src, staging, { recursive: true }); } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
  fs.renameSync(staging, dst);
  try { fs.rmSync(src, { recursive: true, force: true }); } catch { /* harmless leftover */ }
}

function mergeMove(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name), to = path.join(dst, entry.name);
    if (!exists(to)) moveEntry(from, to);
    else if (entry.isDirectory() && fs.statSync(to).isDirectory()) mergeMove(from, to);
  }
  try { fs.rmdirSync(src); } catch { /* not empty */ }
}

/** Returns 'noold' | 'both' | 'moved'. A crash mid-move leaves .migrating in newDir; the next call finishes it. */
export function moveDataDir(oldDir, newDir) {
  const resuming = exists(path.join(newDir, MIGRATING));
  if (!hasPlannerData(oldDir)) {
    if (resuming) fs.rmSync(path.join(newDir, MIGRATING), { force: true });
    return 'noold';
  }
  if (!resuming && hasPlannerData(newDir)) return 'both';
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, MIGRATING), '');
  mergeMove(oldDir, newDir);
  fs.rmSync(path.join(newDir, MIGRATING));
  return 'moved';
}

/** Runs the rule for the default location (`newDir` = <support>/eu.sapd.ccuplanner) and prints the one-time note. */
export function migrateDefault(newDir, log = console.warn) {
  const oldDir = path.join(path.dirname(newDir), LEGACY_IDENTIFIER);
  let result;
  try { result = moveDataDir(oldDir, newDir); } catch (e) {
    log(`warning: could not move the old planner data from ${oldDir}: ${e.message}`);
    return 'error';
  }
  if (result === 'moved') log(`Moved the planner data from ${oldDir} to ${newDir}.`);
  if (result === 'both' && !exists(path.join(newDir, WARNED))) {
    const note = bothNote(oldDir, newDir);
    log(note.trimEnd());
    try { fs.writeFileSync(path.join(newDir, WARNED), note); } catch { /* read-only: warn again next time */ }
  }
  return result;
}
