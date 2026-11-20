// A planner "disk" in memory for the MCP tool tests: revisioned saves like data.mjs, a fresh app on every load().
import fs from 'node:fs';
import { setup } from './ladder.mjs';
import { withDocs } from '../../app/src/lib/view/derive.mjs';

export function world(opts) {
  const { app, ids } = setup(opts);
  const disk = { plans: structuredClone(app.plans), overrides: structuredClone(app.overrides), 'sale-events': structuredClone(app.saleEvents) };
  const saves = [];
  const state = { syncAvailable: false, snapshots: [], runs: [] };
  const deps = {
    allowWrites: true,
    now: () => new Date(2026, 10, 19, 12, 0, 0),
    aliases: null,
    load: () => withDocs({ data: app.data, graph: app.graph }, structuredClone(disk.plans), structuredClone(disk.overrides), structuredClone(disk['sale-events'])),
    snapshots: () => state.snapshots,
    save: (name, doc) => {
      if ((disk[name].rev ?? 0) !== (doc.rev ?? 0)) return false;
      disk[name] = { ...structuredClone(doc), rev: (doc.rev ?? 0) + 1 };
      saves.push(name);
      return true;
    },
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    sync: {
      available: async () => state.syncAvailable,
      run: async (cmd, options, { onProgress }) => {
        state.runs.push({ cmd, options });
        await onProgress?.({ phase: 'upgrades', done: 1, total: 2 });
        await onProgress?.({ phase: 'upgrades', done: 2, total: 2 });
        return { requests: 3, seconds: 0.5 };
      },
    },
  };
  return { deps, disk, saves, state, ids, app };
}
