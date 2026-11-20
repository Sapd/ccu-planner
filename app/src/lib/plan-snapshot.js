// Desktop: records the plan snapshot the CLI sync records (scripts/sync.mjs), so "Since last sync" stays current.
// Reads the data folder through the sync commands (plan-snapshots.json is on their allowlist), builds the
// same snapshot as src/data.mjs recordSnapshot and writes { version: 1, snapshots } back.
import { deriveAppState } from './view/derive.mjs';
import { withSnapshot } from '../../../src/logic/changes.mjs';

const FILE = 'plan-snapshots.json';

/** Returns true when a snapshot was written. Throws on failure: use snapshotQuietly around a sync. */
export async function recordPlanSnapshot(invoke, aliases, at = new Date().toISOString()) {
  const raw = await invoke('load_data');
  if (!raw) return false; // no store data yet: nothing to plan
  const app = deriveAppState(raw, aliases, { applyPricing: false });
  // A damaged (unparsable) file is no history, as in the CLI: it reads as empty and the write below repairs it.
  // Any other read error throws, so the history is never overwritten blindly.
  const doc = await invoke('sync_read', { name: FILE }).catch((e) => {
    if (/^invalid JSON/.test(e?.message ?? String(e))) return null;
    throw e;
  });
  const list = Array.isArray(doc?.snapshots) ? doc.snapshots : [];
  const next = withSnapshot(list, app.session, at);
  if (!next) return false;
  await invoke('sync_write', { name: FILE, value: { version: 1, snapshots: next }, append: false });
  return true;
}

/** A failure here never fails the sync: it only means no history for this run. */
/** `aliases`: the parsed aliases.json, or a function returning it (loaded lazily inside the guard). */
export async function snapshotQuietly(invoke, aliases, warn = (m) => console.warn(m)) {
  try { return await recordPlanSnapshot(invoke, typeof aliases === 'function' ? await aliases() : aliases); } catch (e) { warn(`no plan snapshot: ${e?.message ?? e}`); return false; }
}
