// Desktop-only update check. Installed copies download in the background and install on request.
// Portable copies link to the release so the user can replace the files themselves.
import { backend } from './backend.js';
import { CHECK_FIRST_DELAY_MS, CHECK_EVERY_MS, plainUpdateError, notesText } from './view/updater.mjs';

const inTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export const updater = $state({
  desktop: false,
  portable: null,
  current: '',
  status: 'idle', // idle | checking | downloading | ready | available | uptodate | error
  version: null,
  notes: '',
  error: '',
});

let pending = null;
let started = false;
let busy = false; // one check or download at a time, automatic or manual

async function readPortableMode() {
  updater.portable ??= await backend.portableMode();
  return updater.portable;
}

export async function checkForUpdate(manual = false) {
  if (!inTauri() || busy || updater.status === 'ready') return;
  busy = true;
  if (manual) updater.status = 'checking';
  updater.error = '';
  try {
    const portable = await readPortableMode();
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      updater.status = manual ? 'uptodate' : 'idle';
      return;
    }
    updater.version = update.version;
    if (portable) {
      await update.close();
      updater.status = 'available';
      return;
    }
    updater.notes = notesText(update.body);
    updater.status = 'downloading';
    await update.download();
    pending = update;
    updater.status = 'ready';
  } catch (error) {
    // Offline is normal: the automatic check stays silent.
    if (manual || updater.status !== 'available') {
      updater.status = manual ? 'error' : 'idle';
      updater.error = manual ? plainUpdateError(error) : '';
    }
    pending = null;
  } finally {
    busy = false;
  }
}

export async function restartToUpdate() {
  if (!pending || updater.portable !== false) return;
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
  readPortableMode().catch(() => {});
  import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then((v) => { updater.current = v; }).catch(() => {});
  const first = setTimeout(() => checkForUpdate(false), CHECK_FIRST_DELAY_MS);
  const every = setInterval(() => checkForUpdate(false), CHECK_EVERY_MS);
  return () => { clearTimeout(first); clearInterval(every); started = false; updater.desktop = false; };
}
