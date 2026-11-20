// One interface, two transports: Tauri commands in the desktop app, the
// dev-only Vite plugin (vite-dev-data.js) in a browser.
import { syncBackend } from './sync-backend.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { isRsiUrl } from '../../../src/logic/links.mjs';

// The Tauri data dir, filled by load() so imageSrc can stay synchronous.
let cachedDataDir = null;
const IMAGE_FILE = /^(?:\d+-(s|l)\.webp|\d+-original\.(webp|png|jpe?g|avif|gif)|catalog\/\d+\.(webp|png|jpe?g|avif|gif)|feed\/(?:catalog|ships)\/\d+\.webp)$/;

const inTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

async function viaTauri(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke(cmd, args);
  } catch (e) {
    if (e === 'conflict') throw { conflict: true };
    throw new Error(typeof e === 'string' ? e : e?.message ?? String(e));
  }
}

async function viaHttp(op, body) {
  const res = await fetch(`/__dev/${op}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (res.status === 409) throw { conflict: true };
  if (!res.ok) throw new Error(payload.error ?? `request failed (${res.status})`);
  return payload;
}

async function expandHome(dir) {
  if (!inTauri() || !/^~(\/|$)/.test(dir)) return dir;
  const { homeDir } = await import('@tauri-apps/api/path');
  return (await homeDir()).replace(/\/$/, '') + dir.slice(1);
}

export const backend = {
  ...syncBackend(inTauri, viaTauri, viaHttp),
  /** RawData, or null when the data directory has no catalog yet. */
  load: async () => {
    if (!inTauri()) return viaHttp('load');
    cachedDataDir ??= await viaTauri('data_dir');
    return viaTauri('load_data');
  },
  /** Saves a document at baseRev; resolves to the new rev, throws { conflict: true } when stale. */
  save: (name, doc, baseRev) => (inTauri() ? viaTauri('save_doc', { name, doc, baseRev }) : viaHttp('save', { name, doc, baseRev })),
  /** The CCU Game file kept for after the first sync (pending-import.json), or null. Not part of load(): it is wanted before there is any store data. */
  loadPending: async () => (inTauri() ? viaTauri('sync_read', { name: 'pending-import.json' }) : viaHttp('pending')),
  /** Keeps the pending import (a document) or removes it (null). */
  savePending: async (doc) => (inTauri() ? viaTauri('sync_write', { name: 'pending-import.json', value: doc, append: false }) : viaHttp('pending-save', { doc })),
  /** Copies a legacy checkout's data folder; resolves to { copied, skipped }. */
  importLegacy: async (dir) => (inTauri() ? viaTauri('import_legacy', { dir: await expandHome(dir) }) : viaHttp('import', { dir })),
  /** Opens an RSI page in the system browser. Refuses any other URL. */
  openExternal: async (url) => {
    if (!isRsiUrl(url)) throw new Error('Refusing to open a non-RSI URL');
    if (inTauri()) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      return openUrl(url);
    }
    window.open(url, '_blank', 'noopener');
  },
  /** The store catalog (store-catalog.json), or null when it has not been synced. Tauri: the sync read path; dev: the Vite plugin. */
  loadCatalog: async () => {
    if (!inTauri()) return viaHttp('catalog');
    cachedDataDir ??= await viaTauri('data_dir'); // the pictures' src needs it
    return viaTauri('sync_read', { name: 'store-catalog.json' });
  },
  /** Both builds sync the store catalog: the desktop app through the user's session (Rust), the dev server through its script. */
  canSyncCatalog: () => true,
  /** The desktop app only syncs the catalog through the RSI session; the dev server's script also has a public mode. */
  catalogNeedsSignIn: () => inTauri(),
  /**
   * The signed data feed (sale events, the public store catalog), checked and cached under <data dir>/feed/: by Rust in the desktop app
   * (src-tauri/src/feed.rs), by the dev server's Node code in a browser. Nothing here fetches the feed from the webview.
   *   refresh(force)  one check, at most every 6 hours unless forced -> { status: 'updated'|'unchanged'|'skipped'|'offline'|'rejected', generatedAt, stale, error? } (stale: the held feed is over 30 days old)
   *   images(limit, scope)  downloads up to `limit` missing pictures, ship pictures first -> { downloaded, remaining, failed }; scope 'ships' leaves the catalog pictures
   *   read()          the verified cache -> { generatedAt, eventsDoc, catalog, images: ['catalog/12.webp', 'ships/7.webp', ...] } or null
   */
  feed: {
    refresh: (force = false) => (inTauri() ? viaTauri('feed_refresh', { force }) : viaHttp('feed-refresh', { force })),
    images: (limit = 200, scope = 'all') => (inTauri() ? viaTauri('feed_images', { limit, scope }) : viaHttp('feed-images', { limit, scope })),
    read: () => (inTauri() ? viaTauri('feed_read') : viaHttp('feed')),
  },
  dataDir: async () => (inTauri() ? (cachedDataDir ??= await viaTauri('data_dir')) : viaHttp('dir')),
  /**
   * A loadable src for a local ship picture (a file name like "12-s.webp", from ship.image), or null.
   * Tauri: the asset protocol on <data dir>/images; dev: the Vite plugin's /__dev/images/. Call after load().
   */
  imageSrc: (file) => {
    if (typeof file !== 'string' || !IMAGE_FILE.test(file)) return null;
    if (!inTauri()) return `/__dev/images/${file}`;
    // The feed's pictures ("feed/catalog/<id>.webp") are kept apart from the app's own, in <data dir>/feed/images/.
    if (file.startsWith('feed/')) return cachedDataDir ? convertFileSrc(`${cachedDataDir}/feed/images/${file.slice('feed/'.length)}`) : null;
    return cachedDataDir ? convertFileSrc(`${cachedDataDir}/images/${file}`) : null;
  },
};
