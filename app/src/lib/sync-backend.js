// Desktop runs the shared core in the webview; the dev server runs the Node host.
import { parseOgImage, shipPageUrl } from '../../../src/logic/images.mjs';
import { snapshotQuietly } from './plan-snapshot.js';
let running = false;
let cancelled = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export function syncBackend(inTauri, invoke, http, listenOverride = null) {
  return {
    sessionStatus: () => inTauri() ? invoke('rsi_session_status') : http('session-status'),
    login: () => inTauri() ? invoke('rsi_login') : http('login', {}),
    logout: () => inTauri() ? invoke('rsi_logout') : http('logout', {}),
    cancelSync: () => { cancelled = true; return inTauri() ? invoke('rsi_cancel') : http('sync-cancel', {}); },
    async sync(kind, onProgress = () => {}, { confirmOverwrite } = {}) {
      if (running) throw new Error('A sync is already running');
      if (!['hangar', 'buyback', 'upgrades', 'images', 'store-catalog'].includes(kind)) throw new Error('Unknown sync');
      running = true; cancelled = false;
      let unlisten;
      let locked = false;
      try {
        if (!inTauri()) {
          await http('sync-start', { kind });
          for (;;) {
            const status = await http('sync-status');
            if (status.confirmation) {
              const accept = await confirmOverwrite?.(status.confirmation) ?? false;
              await http('sync-confirm', { id: status.confirmation.id, accept });
            }
            if (status.progress) onProgress(status.progress);
            if (!status.running) {
              if (status.error) throw new Error(/session missing or expired/i.test(status.error) ? 'Sign-in expired' : status.error);
              return;
            }
            await pause(500);
          }
        }
        await invoke('rsi_begin_sync'); // takes <data>/sync.lock; refuses while the CLI, the dev server or the MCP server syncs
        locked = true;
        const listen = listenOverride ?? (await import('@tauri-apps/api/event')).listen;
        unlisten = await listen('sync-progress', ({ payload }) => onProgress(payload));
        const progress = (event) => invoke('sync_progress', { event });
        const readJson = async (name, fallback) => (await invoke('sync_read', { name })) ?? fallback;
        const writeJson = (name, value) => invoke('sync_write', { name, value, append: false });
        if (kind === 'store-catalog') {
          // The same listing code as the dev server's script, through the signed-in session (Rust attaches the cookies); pictures are
          // cached by Rust as images/catalog/<id>.<format>. No plan snapshots: the planner's data does not change.
          const { sync } = await import('../../../src/sync/core.mjs');
          const warnings = [];
          await sync(kind, {
            request: (args) => invoke('rsi_request', args), readJson, writeJson, progress,
            listCatalogImages: () => invoke('sync_read', { name: 'images/catalog' }).then((names) => names ?? []),
            cacheCatalogImage: ({ id, thumbUrl }) => invoke('rsi_cache_catalog_image', { id, url: thumbUrl }),
            appendLine: () => { throw new Error('append is not used by the store catalog'); },
            log: (m) => { if (/^warning:/i.test(m)) warnings.push(m.replace(/^warning:\s*/i, '')); },
          }, { cancelled: () => cancelled });
          return { warnings };
        }
        if (kind === 'images') {
          const catalog = await readJson('catalog.json', null);
          if (!catalog) throw new Error('Sync Store first');
          const store = await readJson('ship-images.json', { images: {} });
          const existing = new Set(await readJson('images', []));
          for (const [i, ship] of catalog.ships.entries()) {
            if (cancelled) throw new Error('Sync cancelled; progress saved');
            if (!store.images[ship.id]?.thumbs || !existing.has(store.images[ship.id].thumbs.s) || !existing.has(store.images[ship.id].thumbs.l)) {
              const page = shipPageUrl(ship.link);
              if (!page) continue;
              const url = parseOgImage(await invoke('rsi_public_page', { url: page }));
              if (cancelled) throw new Error('Sync cancelled; progress saved');
              if (url) {
                const thumbs = await invoke('rsi_cache_image', { id: ship.id, url });
                store.images[ship.id] = { url, thumbs };
                await writeJson('ship-images.json', { ...store, fetchedAt: new Date().toISOString() });
              }
            }
            await progress({ phase: 'images', done: i + 1, total: catalog.ships.length });
          }
          return;
        }
        const { sync } = await import('../../../src/sync/core.mjs');
        // The core's log is dropped, but its warnings (a store account that is not USD) must reach the person.
        const warnings = [];
        // Plan snapshots before and after, like scripts/sync.mjs, so "Since last sync" has something to compare.
        const aliases = async () => (await import('../../../src/logic/aliases.json')).default;
        await snapshotQuietly(invoke, aliases);
        await sync(kind, {
          request: (args) => invoke('rsi_request', args), readJson, writeJson,
          appendLine: (name, line) => invoke('sync_write', { name, value: line, append: true }),
          progress, log: (m) => { if (/^warning:/i.test(m)) warnings.push(m.replace(/^warning:\s*/i, '')); }, confirmOverwrite,
        }, { cancelled: () => cancelled });
        // After the progress has ended: stop listening and give the UI a turn before the snapshot is computed.
        unlisten?.(); unlisten = undefined;
        await pause(0);
        await snapshotQuietly(invoke, aliases);
        return { warnings };
      } finally {
        unlisten?.();
        if (locked) await invoke('rsi_end_sync').catch(() => {});
        running = false;
      }
    },
  };
}
