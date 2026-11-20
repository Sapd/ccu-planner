// Desktop-only update check. Nothing here runs in the browser version. The update is
// downloaded in the background; installing and restarting happen only on the user's click.
import { CHECK_FIRST_DELAY_MS, CHECK_EVERY_MS, plainUpdateError, notesText } from './view/updater.mjs';

const inTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export const updater = $state({
  desktop: false,
  current: '',
  status: 'idle', // idle | checking | downloading | ready | uptodate | error
  version: null,
  notes: '',
  error: '',
});

let pending = null;
let started = false;
let busy = false; // one check or download at a time, automatic or manual

export async function checkForUpdate(manual = false) {
  if (!inTauri() || busy || updater.status === 'ready') return;
  busy = true;
  updater.status = manual ? 'checking' : 'idle';
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      updater.status = manual ? 'uptodate' : 'idle';
      return;
    }
    updater.version = update.version;
    updater.notes = notesText(update.body);
    updater.status = 'downloading';
    await update.download();
    pending = update;
    updater.status = 'ready';
  } catch (error) {
    // Offline is normal: the automatic check stays silent.
    updater.status = manual ? 'error' : 'idle';
    updater.error = manual ? plainUpdateError(error) : '';
    pending = null;
  } finally {
    busy = false;
  }
}

export async function restartToUpdate() {
  if (!pending) return;
  updater.error = '';
  try {
    await pending.install();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (error) {
    // Keep the Restart button so the click can be tried again; the reason shows beside it.
    updater.error = plainUpdateError(error);
  }
}

// Returns a stop function. Safe to call in the browser (does nothing).
export function startUpdater() {
  if (!inTauri() || started) return () => {};
  started = true;
  updater.desktop = true;
  import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then((v) => { updater.current = v; }).catch(() => {});
  const first = setTimeout(() => checkForUpdate(false), CHECK_FIRST_DELAY_MS);
  const every = setInterval(() => checkForUpdate(false), CHECK_EVERY_MS);
  return () => { clearTimeout(first); clearInterval(every); started = false; updater.desktop = false; };
}
