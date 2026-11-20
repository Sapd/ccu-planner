import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDeps, NO_PLAYWRIGHT } from '../src/mcp/node-deps.mjs';
import { acquireSyncLock } from '../src/sync/lock.mjs';
import { TOOLS, ToolError } from '../src/mcp/tools.mjs';
import { tmpName } from '../src/data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-nd-')));

// Static import graph of the server entry: no module reachable by a static import may be playwright, rsi.mjs or session.mjs.
function staticGraph(entry) {
  const seen = new Set();
  const bare = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('.')) visit(path.resolve(path.dirname(file), spec));
      else bare.add(spec);
    }
  };
  visit(entry);
  return { files: [...seen].map((f) => path.relative(root, f).split(path.sep).join('/')), bare: [...bare] };
}

test('the server starts without playwright: it is not in the static module graph', () => {
  const g = staticGraph(path.join(root, 'scripts/mcp.mjs'));
  assert.ok(g.files.includes('src/mcp/tools.mjs') && g.files.includes('src/mcp/node-deps.mjs'));
  assert.ok(!g.bare.some((b) => /playwright/.test(b)), `bare imports: ${g.bare}`);
  assert.ok(!g.files.some((f) => /^src\/(rsi|session)\.mjs$/.test(f)), g.files.join(', '));
});

test('a sync without playwright says so clearly; the read-only tools never need it', async () => {
  const deps = createNodeDeps({ dir: tmp(), loadRsi: async () => { throw Object.assign(new Error("Cannot find package 'playwright'"), { code: 'ERR_MODULE_NOT_FOUND' }); } });
  await assert.rejects(TOOLS.find((t) => t.name === 'sync_store').handler(deps, {}), (e) => e.message === NO_PLAYWRIGHT);
});

test('a sync tool says another sync is running while the lock is held, and sends no request', async () => {
  const dir = tmp();
  let constructed = 0;
  class FakeClient { constructor() { constructed++; } }
  const deps = createNodeDeps({ dir, loadRsi: async () => ({ RsiClient: FakeClient, SESSION_FILE: 'x' }), sessionExists: () => true });
  const release = acquireSyncLock(dir);
  await assert.rejects(TOOLS.find((t) => t.name === 'sync_hangar').handler(deps, {}), /^Error: Another sync is running \(started /);
  release();
  assert.equal(constructed, 0); // the lock is refused before any client exists, so nothing could reach RSI
  assert.ok(!fs.existsSync(path.join(dir, 'sync.lock')));
});

test('cancel during a long run answers at once without dropping the lock early', async () => {
  const w = (await import('./support/mcp-world.mjs')).world({ goals: [] });
  w.state.syncAvailable = true;
  let finish;
  w.deps.sync.run = () => new Promise((r) => { finish = () => r({ requests: 0, seconds: 0 }); });
  const ac = new AbortController();
  const p = TOOLS.find((t) => t.name === 'sync_store').handler(w.deps, {}, { signal: ac.signal });
  ac.abort();
  await assert.rejects(p, /Cancel requested; waiting for the sign-in check to finish/);
  await assert.rejects(TOOLS.find((t) => t.name === 'sync_hangar').handler(w.deps, {}), /already running/);
  finish();
  await new Promise((r) => setTimeout(r, 5));
  w.deps.sync.run = async () => ({ requests: 1, seconds: 0 });
  const again = await TOOLS.find((t) => t.name === 'sync_hangar').handler(w.deps, {}, {});
  assert.match(again.text, /finished/);
});

test('readFile: only an absolute .json outside the data folder and any .local folder', () => {
  const base = tmp();
  const data = path.join(base, 'data');
  const other = path.join(base, 'other');
  fs.mkdirSync(data); fs.mkdirSync(path.join(base, '.local'), { recursive: true }); fs.mkdirSync(other);
  const put = (p, t = '{}') => { fs.writeFileSync(p, t); return p; };
  const ok = put(path.join(other, 'chains.json'));
  const deps = createNodeDeps({ dir: data });
  assert.equal(deps.readFile(ok, 1000), '{}');
  assert.throws(() => deps.readFile('other/chains.json', 1000));
  assert.throws(() => deps.readFile(put(path.join(data, 'plans.json')), 1000));
  assert.throws(() => deps.readFile(put(path.join(base, '.local', 'x.json')), 1000));
  assert.throws(() => deps.readFile(put(path.join(other, 'notes.txt')), 1000));
  assert.throws(() => deps.readFile(put(path.join(other, 'big.json'), '{"a":"' + 'x'.repeat(2000) + '"}'), 1000));
  // a symlink to a file in the data folder is refused (the real path is checked)
  fs.symlinkSync(path.join(data, 'plans.json'), path.join(other, 'link.json'));
  assert.throws(() => deps.readFile(path.join(other, 'link.json'), 1000));
});

test('readFile: the .local and data-folder refusal ignores case where the file system does', (t) => {
  const base = tmp();
  const data = path.join(base, 'Data');
  fs.mkdirSync(data); fs.mkdirSync(path.join(base, '.local'));
  fs.writeFileSync(path.join(base, '.local', 'x.json'), '{}');
  fs.writeFileSync(path.join(data, 'plans.json'), '{}');
  if (!fs.existsSync(path.join(base, '.LOCAL', 'x.json'))) return t.skip('case-sensitive file system');
  const deps = createNodeDeps({ dir: path.join(base, 'DATA') });
  assert.throws(() => deps.readFile(path.join(base, '.LOCAL', 'x.json'), 1000));
  assert.throws(() => deps.readFile(path.join(base, 'dAtA', 'PLANS.json'), 1000));
});

test('compare_ccugame errors are generic', async () => {
  const base = tmp();
  const bad = path.join(base, 'bad.json');
  fs.writeFileSync(bad, '{"nope":1}');
  const w = (await import('./support/mcp-world.mjs')).world({ goals: [] });
  const t = TOOLS.find((x) => x.name === 'compare_ccugame').handler;
  await assert.rejects(t(w.deps, { path: bad }), (e) => e.message === 'This is not a CCU Game saved-chains file.');
  await assert.rejects(t(w.deps, { path: path.join(base, 'missing.json') }), (e) => e.message === 'Could not read that file.');
  await assert.rejects(t(w.deps, { path: 'relative.json' }), /absolute path/);
});

test('temp names are unique per write', () => {
  assert.notEqual(tmpName('/x/plans.json'), tmpName('/x/plans.json'));
  assert.match(tmpName('/x/plans.json'), new RegExp(`^/x/plans\\.json\\.${process.pid}\\.[0-9a-f]{8}\\.tmp$`));
});

test('a non-USD store account is refused by every tool, the writing ones included', async () => {
  const dir = tmp();
  const catalog = (pricing) => ({ app: { pricing }, ships: [{ id: 1, name: 'Pulse', msrp: 5000, owned: false, skus: [] }, { id: 2, name: 'Carrack', msrp: 10000, owned: false, skus: [] }] });
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog({ currencyCode: 'USD', currencySymbol: '$', exponent: 2 })));
  const deps = createNodeDeps({ dir });
  deps.allowWrites = true;
  assert.doesNotThrow(() => deps.load());
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog({ currencyCode: 'EUR', currencySymbol: '€', exponent: 2 })));
  for (const name of ['today', 'goals', 'what_if', 'add_goal']) {
    await assert.rejects(TOOLS.find((t) => t.name === name).handler(deps, { buy: 'Pulse to Carrack', from: 'Pulse', to: 'Carrack' }), (e) => e instanceof ToolError && /USD store accounts only; your account uses EUR/.test(e.message), name);
  }
});
