// Sign-in and sync actions with their busy/progress/confirmation state in `ui`, so they survive the
// first sync swapping the no-data header (App) for the Shell's: no component owns a running sync.
import { backend } from './backend.js';
import { ui, load, loadCatalog } from './state.svelte.js';
import { syncKinds } from './view/onboarding.mjs';
import { applyPending } from './pending-import.svelte.js';

let sessionAsked = false;
/** Asks the backend once whether an RSI session exists. */
export function checkSession() {
  if (sessionAsked) return;
  sessionAsked = true;
  backend.sessionStatus().then((s) => { ui.session = s; }).catch((e) => { sessionAsked = false; ui.notice = e.message; });
}

export const busy = () => ui.syncBusy || ui.signingIn || ui.switching;

export async function login() {
  if (busy()) return;
  ui.signingIn = true;
  try { const notice = await backend.login(); ui.session = 'signed in'; ui.notice = notice ?? 'Signed in to RSI'; }
  catch (e) { ui.notice = e.message; }
  finally { ui.signingIn = false; }
}

export async function logout() {
  try { await backend.logout(); ui.session = 'none'; ui.notice = 'Signed out of RSI'; }
  catch (e) { ui.notice = e.message; }
}

const confirmOverwrite = (detail) => new Promise((resolve) => { ui.confirmation = { ...detail, resolve }; });
export function answer(accept) { const pending = ui.confirmation; ui.confirmation = null; pending?.resolve(accept); }
export function cancel() { answer(false); backend.cancelSync().catch((e) => { ui.notice = e.message; }); }

/** Runs one sync; true when it completed. Does nothing while another one runs or sample data is on. */
export async function sync(kind) {
  if (ui.sample || busy()) return false;
  ui.syncBusy = true; ui.syncResume = null; ui.syncProgress = { phase: kind, done: 0, total: null };
  try {
    const result = await backend.sync(kind, (event) => {
      ui.syncProgress = event;
      if (event.message) ui.syncResume = event.message;
    }, { confirmOverwrite });
    // The store catalog is its own file: it changes nothing the planner shows and says nothing about a bought pledge.
    if (kind === 'store-catalog') await loadCatalog(); else { await load(); ui.bought = false; }
    ui.notice = ['Sync complete', ...(result?.warnings ?? [])].join('. ');
    // A CCU Game file chosen on the welcome screen is imported as soon as the data it needs is there.
    if (kind !== 'store-catalog') await applyPending();
    return true;
  } catch (e) {
    if (/sign.in|session missing/i.test(e.message)) ui.session = 'expired';
    // A cancelled store sync can still have completed sources: refresh those too.
    if (kind === 'store-catalog') await loadCatalog(); else await load();
    ui.notice = e.message;
    return false;
  } finally { answer(false); ui.syncBusy = false; ui.syncProgress = null; ui.syncResume = null; }
}

/** The first-run "Sync store and hangar": only the hangar when the store data is already fresh. */
export async function syncFirstRun(app, now = new Date()) {
  for (const kind of syncKinds(app, now)) if (!(await sync(kind))) return;
}
