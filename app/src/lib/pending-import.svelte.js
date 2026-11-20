// The CCU Game file chosen on the welcome screen before the first sync: kept in memory (ui.pending) and in the data folder
// (pending-import.json), imported as goals once the store and the hangar are synced. The state lives in `ui`, so the welcome
// screen being replaced by the app when the first sync loads data does not lose it.
import { backend } from './backend.js';
import { ui, dispatch } from './state.svelte.js';
import aliases from '../../../src/logic/aliases.json';
import { makePending, readPending, pendingReady, planPending, summarize } from './view/pendingImport.mjs';

/** Reads the kept file at start. A missing or damaged file is no pending import. */
export async function loadPending() {
  try { ui.pending = readPending(await backend.loadPending()); } catch { ui.pending = null; }
}

const keep = async (doc) => {
  try { await backend.savePending(doc); return true; }
  catch (e) { ui.notice = `Could not save the CCU Game file for later (${e?.message ?? e}). It is kept until you close the app.`; return false; }
};

/** Parses and validates the file now (throws the parser's message), then keeps it for after the sync. */
export async function stagePending(file) {
  const pending = makePending(await file.text());
  ui.pending = pending;
  ui.importResult = null;
  await keep(pending);
}

export async function removePending() {
  ui.pending = null;
  await keep(null);
}

let applying = false;
/** Runs the pending import when the data is there. Safe to call after every load: it does nothing until the store and the hangar are synced. */
export async function applyPending() {
  const app = ui.app;
  if (applying || ui.sample || !ui.pending || !pendingReady(app)) return;
  applying = true;
  try {
    const { rows, count } = planPending(ui.pending, { ships: app.data.ships, aliases, plans: app.plans, lti: app.data.lti ?? [] });
    let added = 0;
    if (count) {
      const ids = await dispatch({ type: 'importGoals', rows });
      if (!ids) return; // the save failed (the notice says why): the file stays for the next try
      added = ids.length;
    }
    ui.importResult = summarize(rows, added);
    ui.pending = null;
    await keep(null);
  } finally { applying = false; }
}
