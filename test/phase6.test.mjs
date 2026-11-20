import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { money, usd, setPricing, currencyProblem, normalizePricing } from '../src/logic/format.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { deriveAppState } from '../app/src/lib/view/derive.mjs';
import { onboardingSteps } from '../app/src/lib/view/onboarding.mjs';
import { createSampleBackend } from '../app/src/lib/view/sample.mjs';
import { createController } from '../app/src/lib/view/controller.mjs';
import { buildSample } from '../src/logic/sampleData.mjs';
import { GLOSSARY, glossaryEntry } from '../src/logic/glossary.mjs';
import { createBackendSwitch, switchBackend } from '../app/src/lib/view/backendSwitch.mjs';
import { recordPlanSnapshot, snapshotQuietly } from '../app/src/lib/plan-snapshot.js';
import { SNAPSHOT_MAX } from '../src/logic/changes.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/raw-small.json', import.meta.url), 'utf8'));
const aliases = { items: {} };
const withPricing = (pricing) => ({ ...fixture, catalog: { ...fixture.catalog, app: { pricing } } });

// ----- money -----
test('money: exponent 2, whole amounts without decimals, unknown as ?', () => {
  const p = { currencyCode: 'USD', currencySymbol: '$', exponent: 2 };
  assert.equal(money(4250, p), '$42.50');
  assert.equal(money(4000, p), '$40');
  assert.equal(money(0, p), '$0');
  assert.equal(money(null, p), '?');
  assert.equal(money(1234, { currencyCode: 'EUR', currencySymbol: '€', exponent: 2 }), '€12.34');
  assert.equal(money(1200, { currencyCode: 'JPY', currencySymbol: '¥', exponent: 0 }), '¥1200');
});

test('money: missing or unusable pricing falls back to USD', () => {
  assert.equal(money(4250, undefined), '$42.50');
  assert.equal(money(4250, {}), '$42.50');
  assert.equal(money(4250, null), '$42.50');
  assert.deepEqual({ ...normalizePricing({ currencyCode: 'USD' }) }, { currencyCode: 'USD', currencySymbol: '$', exponent: 2, declared: true, taxRate: 0, isTaxInclusive: false });
  assert.equal(usd(5000), '$50');
});

const EUR = { currencyCode: 'EUR', currencySymbol: '€', exponent: 2 };
const USD = { currencyCode: 'USD', currencySymbol: '$', exponent: 2, taxRate: 0 };

test('loading data sets the default pricing; building data does not', () => {
  try {
    buildPlannerData(withPricing(EUR), aliases);
    assert.equal(usd(4250), '$42.50', 'buildPlannerData leaves the formatter alone');
    const app = deriveAppState(withPricing(EUR), aliases);
    assert.equal(app.data.pricing.currencyCode, 'EUR');
    assert.equal(usd(4250), '€42.50');
    deriveAppState(withPricing(USD), aliases, { applyPricing: false });
    assert.equal(usd(4250), '€42.50', 'applyPricing: false (the sync snapshot) does not touch it');
    deriveAppState(withPricing(USD), aliases);
    assert.equal(usd(4250), '$42.50');
  } finally { setPricing(null); }
});

test('unsupported accounts: other currency, no currency, taxed USD; a plain USD account passes', () => {
  assert.match(currencyProblem(EUR), /USD store accounts only; your account uses EUR/);
  assert.match(currencyProblem(normalizePricing(EUR)), /your account uses EUR/);
  assert.match(currencyProblem(undefined), /Sync the store again/);
  assert.match(currencyProblem({}), /Sync the store again/);
  assert.match(currencyProblem({ ...USD, taxRate: 0.2, isTaxInclusive: false }), /tax added on top/);
  assert.equal(currencyProblem({ ...USD, taxRate: 0.2, isTaxInclusive: true }), null);
  assert.equal(currencyProblem(USD), null);
  assert.equal(currencyProblem(normalizePricing(USD)), null);
  assert.equal(buildPlannerData(withPricing(USD), aliases).pricing.currencyCode, 'USD');
});

test('CLI exits non-zero with the same message for an unsupported account, and works for USD', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-eur-'));
  try {
    const run = (pricing) => {
      fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(withPricing(pricing).catalog));
      return spawnSync(process.execPath, ['scripts/chain.mjs', 'list'], { encoding: 'utf8', env: { ...process.env, CCU_DATA: dir } });
    };
    const bad = run(EUR);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /USD store accounts only; your account uses EUR/);
    assert.notEqual(run(undefined).status, 0);
    assert.equal(run(USD).status, 0);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

// ----- onboarding and sample data -----
test('onboarding: steps follow the real data', () => {
  const state = (session, app) => onboardingSteps({ session, app }).map((s) => `${s.key}:${s.done ? 'done' : s.next ? 'next' : 'later'}`);
  assert.deepEqual(state('none', null), ['signin:next', 'sync:later', 'goal:later']);
  assert.deepEqual(state('signed in', null), ['signin:done', 'sync:next', 'goal:later']);
  const store = { data: { meta: { catalogAt: 'C', hangarAt: null } }, plans: { chains: {} } };
  assert.deepEqual(state('none', store), ['signin:next', 'sync:later', 'goal:later'], 'imported data is not a sign-in');
  assert.deepEqual(state('signed in', store), ['signin:done', 'sync:next', 'goal:later']);
  assert.match(onboardingSteps({ session: 'expired', app: null })[0].text, /run out/);
  const [signin, sync, goal] = onboardingSteps({ session: 'none', app: null });
  assert.equal(signin.text, 'Opens the RSI website; the planner never sees your password.');
  assert.deepEqual([signin.note, sync.note, goal.note], ['', 'takes a minute or two', ''], 'labels are separate fields, never glued into the title');
  assert.deepEqual(onboardingSteps({ session: 'signed in', app: null })[0].note, 'already signed in');
  const synced = { data: { meta: { catalogAt: 'C', hangarAt: 'H' } }, plans: { chains: {} } };
  assert.deepEqual(state('signed in', synced), ['signin:done', 'sync:done', 'goal:next']);
  assert.deepEqual(state('signed in', { ...synced, plans: { chains: { c1: {} } } }), ['signin:done', 'sync:done', 'goal:done']);
});

test('sample data: loads a goal, saves in memory only, rev conflicts like the real store', async () => {
  const sample = buildSample(fixture);
  const committed = JSON.parse(fs.readFileSync(new URL('../app/src/lib/sample-data.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(sample)), 'run node scripts/build-sample.mjs');
  const backend = createSampleBackend(committed);
  const c = createController(backend, aliases);
  await c.load();
  assert.equal(Object.keys(c.state.plans.chains).length, 1);
  const before = JSON.stringify(committed);
  await c.dispatch({ type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 2, name: 'Second' });
  assert.equal(Object.keys(c.state.plans.chains).length, 2);
  assert.equal(JSON.stringify(committed), before, 'the bundled sample is not modified');
  await assert.rejects(() => backend.save('plans', {}, 99), (e) => e.conflict === true);
  await assert.rejects(() => backend.save('plan-snapshots', {}, 0), /unknown document/);
  await c.load();
  assert.equal(Object.keys(c.state.plans.chains).length, 2, 'a reload keeps the in-memory edits');
  assert.equal(Object.keys((await createSampleBackend(committed).load()).plans.chains).length, 1, 'a new sample starts fresh');
});

test('sample module and state never import node fs or the real backend writers', () => {
  const src = fs.readFileSync(new URL('../app/src/lib/view/sample.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /import\s/);
});

// ----- glossary -----
test('glossary: the required terms, short plain entries, no internal ids', () => {
  const keys = GLOSSARY.map((e) => e.key);
  for (const k of ['ccu', 'standard-warbond', 'store-credit', 'lti', 'insurance', 'downward', 'melt', 'buyback', 'concept', 'sale-event', 'chain', 'lock', 'accept', 'priority', 'alone', 'pledge', 'giftable']) assert.ok(keys.includes(k), k);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(glossaryEntry('melt'));
  assert.equal(glossaryEntry('nope'), null);
  for (const e of GLOSSARY) {
    const text = `${e.term} ${e.text}`;
    assert.doesNotMatch(text, /\bc\d+\b|\b\d{3,}\b|undefined|\[object/, e.key);
    assert.ok(e.text.length > 30 && e.text.length < 400, e.key);
  }
  // newcomer order: what a CCU is and its two kinds first, selling back last
  assert.deepEqual(keys.slice(0, 3), ['ccu', 'standard-warbond', 'store-credit']);
  assert.ok(keys.indexOf('chain') < keys.indexOf('melt'));
  assert.match(glossaryEntry('store-credit').text, /Only Standard/);
  assert.match(glossaryEntry('standard-warbond').text, /Standard upgrades use the regular price and can use store credit when offered\. Warbond upgrades require new cash and are usually discounted/);
  assert.doesNotMatch(glossaryEntry('standard-warbond').text, /always on sale/);
  assert.match(glossaryEntry('full-price').text, /not money you saved or spent/);
  assert.match(glossaryEntry('insurance').text, /best insurance of the pledge/);
  assert.match(glossaryEntry('buyback').text, /does not use buyback/);
  assert.match(glossaryEntry('downward').text, /Only buying a new upgrade that goes down/);
});

// ----- layers and Store-only sale events -----
test('z-index values use the named layers', () => {
  const dir = fileURLToPath(new URL('../app/src/', import.meta.url));
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); })(dir);
  for (const f of files.filter((x) => /\.(svelte|css)$/.test(x))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/z-index:\s*([^;}\s]+)/g)) assert.match(m[1], /^var\(--z-[a-z]+\)$/, f);
  }
  const tokens = fs.readFileSync(path.join(dir, 'lib/ui/tokens.css'), 'utf8');
  for (const n of ['sticky', 'popover', 'bar', 'modal']) assert.match(tokens, new RegExp(`--z-${n}:`));
});

test('sale events are edited on the Store page only', () => {
  const read = (f) => fs.readFileSync(new URL(`../app/src/lib/${f}`, import.meta.url), 'utf8');
  assert.doesNotMatch(read('PricesTab.svelte'), /<SaleEvents/);
  assert.match(read('PricesTab.svelte'), /openSaleEvents\(\)/, 'Prices links to the Sale events section, not just the Store tab');
  assert.match(read('Shell.svelte'), /<SaleEvents/);
});

// ----- plan snapshots after an in-app sync -----
function fakeStore(initial = {}) {
  const files = { ...initial };
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push(cmd);
    if (cmd === 'load_data') return structuredClone({ ...fixture, plans: null, overrides: null, planSnapshots: files['plan-snapshots.json'] ?? null });
    if (cmd === 'sync_read') return files[args.name] ?? null;
    if (cmd === 'sync_write') { assert.equal(args.append, false); files[args.name] = structuredClone(args.value); return; }
    throw new Error(`unexpected ${cmd}`);
  };
  return { files, invoke, calls };
}

test('desktop sync snapshot: same shape as the CLI, replaced for the same data, skipped when nothing changed, newest 30', async () => {
  const s = fakeStore();
  assert.equal(await recordPlanSnapshot(s.invoke, aliases, 'T1'), true);
  const doc = s.files['plan-snapshots.json'];
  assert.deepEqual(Object.keys(doc), ['version', 'snapshots']);
  assert.equal(doc.version, 1);
  assert.deepEqual(Object.keys(doc.snapshots[0]).sort(), ['at', 'copies', 'goals', 'hangarAt', 'msrp', 'offersAt', 'revs', 'storeAt', 'total']);
  assert.equal(await recordPlanSnapshot(s.invoke, aliases, 'T2'), false, 'same data and plan: nothing written');
  // Older snapshots of other data are kept up to the limit.
  s.files['plan-snapshots.json'] = { version: 1, snapshots: Array.from({ length: 40 }, (_, i) => ({ at: `t${i}`, storeAt: `S${i}`, hangarAt: 'H', offersAt: null, revs: null })) };
  assert.equal(await recordPlanSnapshot(s.invoke, aliases, 'T3'), true);
  const kept = s.files['plan-snapshots.json'].snapshots;
  assert.equal(kept.length, SNAPSHOT_MAX);
  assert.equal(kept.at(-1).at, 'T3');
});

test('desktop sync snapshot: a corrupt plan-snapshots.json counts as empty and is repaired by the next snapshot', async () => {
  const s = fakeStore({ 'plan-snapshots.json': 'garbage' });
  const invoke = async (cmd, args) => {
    if (cmd === 'sync_read') throw new Error('invalid JSON: expected value at line 1 column 1');
    return s.invoke(cmd, args);
  };
  assert.equal(await recordPlanSnapshot(invoke, aliases, 'T1'), true);
  assert.equal(s.files['plan-snapshots.json'].snapshots.length, 1);
});

test('desktop sync snapshot: no store data writes nothing; a failure never fails the sync', async () => {
  const empty = { invoke: async (cmd) => { assert.equal(cmd, 'load_data'); return null; } };
  assert.equal(await recordPlanSnapshot(empty.invoke, aliases), false);
  const warnings = [];
  const broken = async () => { throw new Error('disk full'); };
  assert.equal(await snapshotQuietly(broken, aliases, (m) => warnings.push(m)), false);
  assert.match(warnings[0], /disk full/);
  const s = fakeStore();
  assert.equal(await snapshotQuietly(s.invoke, async () => { throw new Error('no aliases'); }, (m) => warnings.push(m)), false);
  assert.match(warnings[1], /no aliases/);
});

// ----- leaving sample mode never writes sample documents to the real backend -----
test('backend switch: a save is bound to the backend its state was loaded from', async () => {
  const real = { received: [], load: async () => structuredClone({ ...fixture, plans: null, overrides: null }), save: async (...a) => { real.received.push(a); return 1; } };
  const sample = createSampleBackend(buildSample(fixture));
  const route = createBackendSwitch(real);
  const c = createController(route, aliases);
  await c.load();
  await route.switchTo(sample, () => c.load());
  assert.equal(Object.keys(c.state.plans.chains).length, 1, 'the sample is shown');

  // A failing real load: still on sample, error thrown, a save goes to the sample only.
  real.load = async () => { throw new Error('disk gone'); };
  await assert.rejects(() => route.switchTo(real, () => c.load()), /disk gone/);
  await c.dispatch({ type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 2, name: 'Edit' });
  assert.deepEqual(real.received, []);
  assert.equal(Object.keys(c.state.plans.chains).length, 2);

  // A slow real load: a save made meanwhile still goes to the sample.
  let release;
  real.load = () => new Promise((r) => { release = () => r(structuredClone({ ...fixture, plans: null, overrides: null })); });
  const leaving = route.switchTo(real, () => c.load());
  await c.dispatch({ type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 3, name: 'Slow' });
  assert.deepEqual(real.received, [], 'nothing reached the real backend while it was loading');
  release();
  await leaving;
  assert.equal(Object.keys(c.state.plans.chains).length, 0, 'the real data is shown');
  await c.dispatch({ type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 2, name: 'Real' });
  assert.equal(real.received.length, 1, 'after the switch, saves go to the real backend');
  assert.equal(real.received[0][1].chains.c1.name, 'Real');
});

// ----- fix round 2: commit order and in-flight saves -----
const raw0 = () => structuredClone({ ...fixture, plans: null, overrides: null });

test('backend switch: the real load succeeds but deriving throws; a later save does not reach the real backend', async () => {
  const real = { received: [], load: async () => raw0(), save: async (...a) => { real.received.push(a); return 1; } };
  const sample = createSampleBackend(buildSample(fixture));
  const route = createBackendSwitch(real);
  const c = createController(route, aliases);
  await c.load();
  await switchBackend(route, c, sample);
  assert.equal(Object.keys(c.state.plans.chains).length, 1);
  real.load = async () => ({ catalog: null }); // loads fine, but buildPlannerData throws
  await assert.rejects(() => switchBackend(route, c, real));
  assert.equal(route.current(), sample);
  await c.dispatch({ type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 2, name: 'Edit' });
  assert.deepEqual(real.received, []);
  assert.equal(Object.keys(c.state.plans.chains).length, 2, 'the sample state is still shown and saved');
});

test('backend switch: a save in flight finishes before the switch, and a late result of the old backend is dropped', async () => {
  const mk = () => {
    const real = { received: [], load: async () => raw0(), save: async (...a) => { real.received.push(a); return 1; } };
    let release;
    const sample = createSampleBackend(buildSample(fixture));
    const inner = sample.save;
    sample.save = (...a) => new Promise((r) => { release = () => r(inner(...a)); });
    return { real, sample, release: () => release() };
  };
  // Drained: the switch waits for the save.
  let t = mk();
  let route = createBackendSwitch(t.real);
  let c = createController(route, aliases);
  await c.load();
  await switchBackend(route, c, t.sample);
  const saving = c.dispatch({ type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 2, name: 'Edit' });
  let switched = false;
  const leaving = switchBackend(route, c, t.real).then(() => { switched = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(switched, false, 'the switch waits for the save in flight');
  t.release();
  await saving; await leaving;
  assert.equal(Object.keys(c.state.plans.chains).length, 0, 'the real data is shown, not overwritten by the late save');
  // Not drained: a save result of the old backend is dropped.
  t = mk();
  route = createBackendSwitch(t.real);
  c = createController(route, aliases);
  await c.load();
  await switchBackend(route, c, t.sample);
  const late = c.dispatch({ type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 2, name: 'Edit' });
  await new Promise((r) => setTimeout(r, 0));
  await route.switchTo(t.real, () => c.load());
  t.release();
  await late;
  assert.equal(Object.keys(c.state.plans.chains).length, 0, 'the old backend result did not replace the new state');
});

test('desktop sync snapshot: only a parse error counts as empty; a read error skips the snapshot and keeps the history', async () => {
  const s = fakeStore({ 'plan-snapshots.json': { version: 1, snapshots: [{ at: 'old' }] } });
  const invoke = async (cmd, args) => {
    if (cmd === 'sync_read') throw new Error('Permission denied (os error 13)');
    return s.invoke(cmd, args);
  };
  const warnings = [];
  assert.equal(await snapshotQuietly(invoke, aliases, (m) => warnings.push(m)), false);
  assert.match(warnings[0], /Permission denied/);
  assert.equal(s.files['plan-snapshots.json'].snapshots[0].at, 'old');
  const parse = async (cmd, args) => { if (cmd === 'sync_read') throw new Error('invalid JSON: expected value at line 1 column 1'); return s.invoke(cmd, args); };
  assert.equal(await recordPlanSnapshot(parse, aliases, 'T'), true);
});

test('signing in syncs right away: the first-run sync after a successful sign-in, not with sample data', () => {
  const src = fs.readFileSync(new URL('../app/src/lib/sync-actions.svelte.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function login()'), src.indexOf('export async function logout()'));
  assert.match(body, /signedIn = true;/);
  assert.match(body, /if \(signedIn && !ui\.sample\) await syncFirstRun\(ui\.app\);/);
  assert.ok(body.indexOf('syncFirstRun') > body.indexOf('ui.signingIn = false'), 'after the sign-in has ended, so the sync is not refused as busy');
});

test('sync: a pending overwrite question is answered no when the sync ends', () => {
  const src = fs.readFileSync(new URL('../app/src/lib/sync-actions.svelte.js', import.meta.url), 'utf8');
  assert.match(src, /finally \{ answer\(false\)/);
});
