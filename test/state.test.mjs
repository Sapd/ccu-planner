import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain, ConflictError } from '../src/logic/chains.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { DEFAULT_TOKENS } from '../src/logic/tokens.mjs';
import { loadOverrides, saveOverrides, loadPlans, savePlans } from '../src/data.mjs';

// Ladder: 1=$50, 2=$75, 3=$100, 4=$150, 5=$200
const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000 };
const standard = () => {
  const out = [];
  for (const f of [1, 2, 3, 4, 5]) for (const t of [1, 2, 3, 4, 5]) if (MSRP[t] > MSRP[f]) out.push({ from: f, to: t, kind: 'standard', cash: MSRP[t] - MSRP[f] });
  return out;
};
const copy = (copyId, from, to) => ({ copyId, from, to });
const doc = () => ({ plans: newState(), overrides: { rev: 0, ships: {} } });

test('applyAction never mutates its input document', () => {
  const d = doc();
  const before = structuredClone(d);
  const added = applyAction(d, { type: 'addChain', base: 2, target: 4, name: 'A' });
  assert.deepEqual(d, before, 'addChain left the input alone');
  const credited = applyAction(added, { type: 'setCredit', cents: 5000 });
  assert.equal(added.plans.profile.credit, 0, 'setCredit left the earlier result alone');
  const priced = applyAction(credited, { type: 'setPrice', shipId: 4, cents: 16000, note: 'x' });
  assert.equal(credited.overrides.ships[4], undefined, 'setPrice left the earlier result alone');
  assert.equal(priced.plans.profile.credit, 5000);
});

test('addChain then remove leaves no chains and keeps nextId advanced', () => {
  let d = applyAction(doc(), { type: 'addChain', base: 2, target: 4, name: 'A' });
  assert.equal(d.result.id, 'c1');
  d = applyAction(d, { type: 'remove', chainId: 'c1' });
  assert.deepEqual(d.plans.chains, {});
  assert.equal(d.plans.nextId, 2);
});

test('setPriority rejects an unknown priority', () => {
  const d = applyAction(doc(), { type: 'addChain', base: 2, target: 4 });
  assert.throws(() => applyAction(d, { type: 'setPriority', chainId: 'c1', value: 'urgent' }), /priority/);
  const ok = applyAction(d, { type: 'setPriority', chainId: 'c1', value: 'high' });
  assert.equal(ok.plans.chains.c1.priority, 'high');
});

test('setPrice rejects a price of zero or less', () => {
  assert.throws(() => applyAction(doc(), { type: 'setPrice', shipId: 4, cents: 0 }));
  assert.throws(() => applyAction(doc(), { type: 'setPrice', shipId: 4, cents: -5 }));
});

test('setPrice writes an override and clearPrice removes it; both report overrides as changed', () => {
  const a = applyAction(doc(), { type: 'setPrice', shipId: 4, cents: 16000, note: 'announced' });
  assert.equal(a.changed, 'overrides');
  assert.deepEqual(Object.keys(a.overrides.ships[4]).sort(), ['msrp', 'note', 'setAt']);
  assert.equal(a.overrides.ships[4].msrp, 16000);
  assert.equal(a.overrides.ships[4].note, 'announced');
  assert.equal(typeof a.overrides.ships[4].setAt, 'string');
  const b = applyAction(a, { type: 'clearPrice', shipId: 4 });
  assert.equal(b.changed, 'overrides');
  assert.equal(b.overrides.ships[4], undefined);
});

test('setPrice without a note stores note null', () => {
  const a = applyAction(doc(), { type: 'setPrice', shipId: 4, cents: 16000 });
  assert.equal(a.overrides.ships[4].note, null);
});

test('plan actions report plans as changed', () => {
  assert.equal(applyAction(doc(), { type: 'setCredit', cents: 100 }).changed, 'plans');
  assert.equal(applyAction(doc(), { type: 'addChain', base: 2, target: 4 }).changed, 'plans');
});

test('setCredit stores whole cents and rejects negative amounts', () => {
  assert.equal(applyAction(doc(), { type: 'setCredit', cents: 0 }).plans.profile.credit, 0);
  assert.throws(() => applyAction(doc(), { type: 'setCredit', cents: -1 }));
});

test('accepting a route that uses a copy reserved by another chain throws ConflictError', () => {
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  let d = applyAction(doc(), { type: 'addChain', base: 2, target: 4, name: 'A' });
  d = applyAction(d, { type: 'addChain', base: 2, target: 4, name: 'B' });
  const routeA = proposeChain(d.plans, 'c1', g).routes[0];
  // B planned alone (as if before A existed), so it claims x too; shared planning would route B around A.
  const solo = newState();
  addChain(solo, { base: 2, target: 4 });
  const routeB = proposeChain(solo, 'c1', g).routes[0];
  d = applyAction(d, { type: 'accept', chainId: 'c1', route: routeA }, { meta: { catalogAt: 'now' } });
  assert.equal(d.result.rev, 1);
  assert.throws(() => applyAction(d, { type: 'accept', chainId: 'c2', route: routeB }, {}), ConflictError);
});

test('acceptFleet accepts goals that have a route and leaves accepted goals untouched (rev, acceptedAt, history)', () => {
  const g = buildGraph({ offers: standard(), owned: [copy('x', 2, 4)] });
  let d = applyAction(doc(), { type: 'addChain', base: 2, target: 4 });
  d = applyAction(d, { type: 'addChain', base: 2, target: 4 });
  const routeA = proposeChain(d.plans, 'c1', g).routes[0];
  d = applyAction(d, { type: 'accept', chainId: 'c1', route: routeA }, { meta: { catalogAt: 'then' } });
  const before = structuredClone(d.plans.chains.c1);
  const routeB = proposeChain(d.plans, 'c2', g).routes[0];
  d = applyAction(d, { type: 'acceptFleet', plans: [{ chainId: 'c1', route: routeA }, { chainId: 'c2', route: routeB }] });
  assert.deepEqual(d.plans.chains.c1, before, 'c1 not touched');
  assert.equal(d.plans.chains.c1.accepted.rev, 1);
  assert.ok(d.plans.chains.c2.accepted, 'c2 accepted');
  d = applyAction(d, { type: 'acceptFleet', plans: [{ chainId: 'c1', route: null }, { chainId: 'c2', route: null }] });
  assert.ok(d.plans.chains.c1.accepted && d.plans.chains.c2.accepted, 'a goal without a route in the plan keeps its accepted route');
});

test('actions on an unknown chain throw', () => {
  for (const action of [
    { type: 'release', chainId: 'c9' },
    { type: 'remove', chainId: 'c9' },
    { type: 'setMode', chainId: 'c9', value: 'finish' },
    { type: 'setPriority', chainId: 'c9', value: 'high' },
  ]) assert.throws(() => applyAction(doc(), action), /unknown chain c9/, action.type);
});

test('addChain checks the ships when a ship list is given', () => {
  const ships = new Map([[2, {}], [4, {}]]);
  assert.ok(applyAction(doc(), { type: 'addChain', base: 2, target: 4 }, { ships }).result);
  assert.throws(() => applyAction(doc(), { type: 'addChain', base: 2, target: 99 }, { ships }), /unknown ship 99/);
});

test('applyAction does not change either rev; the store bumps them', () => {
  const d = { plans: { ...newState(), rev: 7 }, overrides: { rev: 3, ships: {} } };
  let r = applyAction(d, { type: 'addChain', base: 2, target: 4 });
  r = applyAction(r, { type: 'setCredit', cents: 100 });
  r = applyAction(r, { type: 'setMode', chainId: 'c1', value: 'finish' });
  assert.equal(r.plans.rev, 7);
  r = applyAction(r, { type: 'setPrice', shipId: 4, cents: 16000 });
  assert.equal(r.overrides.rev, 3);
  assert.equal(r.plans.rev, 7);
});

// Store: rev handling for the two documents the CLI writes.

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-state-test-'));
}

test('loadOverrides reads an absent file as rev 0 with no ships', () => {
  const dir = tempDir();
  assert.deepEqual(loadOverrides(dir), { rev: 0, ships: {} });
});

test('loadOverrides reads a file without rev as rev 0 and keeps its ships', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'price-overrides.json'), JSON.stringify({ ships: { 109: { msrp: 17500, note: null, setAt: 'x' } } }));
  const o = loadOverrides(dir);
  assert.equal(o.rev, 0);
  assert.equal(o.ships[109].msrp, 17500);
});

test('saveOverrides writes rev + 1 and each later save bumps by exactly one', () => {
  const dir = tempDir();
  assert.equal(saveOverrides(loadOverrides(dir), dir), true);
  assert.equal(loadOverrides(dir).rev, 1);
  assert.equal(saveOverrides(loadOverrides(dir), dir), true);
  assert.equal(loadOverrides(dir).rev, 2);
});

test('saveOverrides refuses a document loaded before the file moved on, and writes nothing', () => {
  const dir = tempDir();
  const stale = loadOverrides(dir);
  assert.equal(saveOverrides(loadOverrides(dir), dir), true);
  assert.equal(saveOverrides(stale, dir), false);
  assert.equal(loadOverrides(dir).rev, 1);
});

test('savePlans writes rev + 1 and refuses a stale document', () => {
  const dir = tempDir();
  const first = loadPlans(dir);
  assert.equal(first.rev, 0);
  assert.equal(savePlans(first, dir), true);
  assert.equal(loadPlans(dir).rev, 1);
  assert.equal(savePlans(first, dir), false, 'first is rev 0 but the file is rev 1');
  assert.equal(loadPlans(dir).rev, 1);
});

test('addChain rejects equal ships, missing ships and unknown ids', () => {
  const ships = new Map([[1, { id: 1 }], [2, { id: 2 }]]);
  assert.throws(() => applyAction(doc(), { type: 'addChain', base: 1, target: 1 }, { ships }), /must differ/);
  assert.throws(() => applyAction(doc(), { type: 'addChain', base: null, target: 2 }, { ships }), /needs a start and a target/);
  assert.throws(() => applyAction(doc(), { type: 'addChain', base: 1 }, { ships }), /needs a start and a target/);
  assert.throws(() => applyAction(doc(), { type: 'addChain', base: 1, target: 99 }, { ships }), /unknown ship 99/);
  assert.equal(applyAction(doc(), { type: 'addChain', start: { kind: 'ship', ship: 1 }, target: 2 }, { ships }).result.start.ship, 1);
});

// --- goal starts and token settings ---
test('addChain with a token start and no name is named after the target', () => {
  const ships = new Map([[4, { id: 4, name: 'Four' }], [2, { id: 2, name: 'Two' }]]);
  const d = applyAction(doc(), { type: 'addChain', start: { kind: 'token' }, target: 4 }, { ships });
  assert.equal(d.result.name, 'Four');
  assert.deepEqual(d.result.start, { kind: 'token' });
  assert.throws(() => applyAction(doc(), { type: 'addChain', target: 4 }), /needs a start and a target ship/);
  assert.throws(() => applyAction(doc(), { type: 'addChain', start: { kind: 'ship', ship: 4 }, target: 4 }), /start and target must differ/);
  assert.throws(() => applyAction(doc(), { type: 'addChain', start: { kind: 'ship', ship: 9 }, target: 4 }, { ships }), /unknown ship 9/);
});

test('setStart replaces the start and releases the accepted route', () => {
  let d = applyAction(doc(), { type: 'addChain', start: { kind: 'token' }, target: 4, name: 'A' });
  d.plans.chains.c1.accepted = { rev: 1, steps: [] };
  d = applyAction(d, { type: 'setStart', chainId: 'c1', start: { kind: 'ship', ship: 2 } });
  assert.deepEqual(d.plans.chains.c1.start, { kind: 'ship', ship: 2 });
  assert.equal(d.plans.chains.c1.accepted, null);
  assert.equal(d.plans.chains.c1.history.length, 1);
});

test('markToken moves a pledge between use and never, null clears, and they stay exclusive', () => {
  let d = applyAction(doc(), { type: 'markToken', pledgeId: '5', mark: 'use' });
  assert.deepEqual(d.plans.profile.tokens.use, ['5']);
  d = applyAction(d, { type: 'markToken', pledgeId: '5', mark: 'never' });
  assert.deepEqual(d.plans.profile.tokens.use, []);
  assert.deepEqual(d.plans.profile.tokens.never, ['5']);
  d = applyAction(d, { type: 'markToken', pledgeId: '5', mark: null });
  assert.deepEqual(d.plans.profile.tokens.never, []);
});

test('setTokenSettings merges, validates, and never shares the default arrays', () => {
  let d = applyAction(doc(), { type: 'markToken', pledgeId: '5', mark: 'use' });
  d = applyAction(d, { type: 'setTokenSettings', tokens: { limitCents: 5000 } });
  assert.equal(d.plans.profile.tokens.limitCents, 5000);
  assert.deepEqual(d.plans.profile.tokens.use, ['5']);
  assert.throws(() => applyAction(doc(), { type: 'setTokenSettings', tokens: { limitCents: 12.5 } }), /token limit must be a whole number of cents/);
  assert.throws(() => applyAction(doc(), { type: 'setTokenSettings', tokens: { limitCents: -1 } }), /token limit must be a whole number of cents/);
  assert.throws(() => applyAction(doc(), { type: 'setTokenSettings', tokens: { use: [1] } }), /use must be an array of strings/);
  const e = applyAction(doc(), { type: 'setTokenSettings', tokens: { limitCents: 100 } });
  e.plans.profile.tokens.use.push('x');
  assert.deepEqual(DEFAULT_TOKENS.use, []);
});

test('addChain and setStart store a copy of start and check a token pledgeId', () => {
  const start = { kind: 'token', pledgeId: '7' };
  const d = applyAction(doc(), { type: 'addChain', start, target: 4 });
  start.pledgeId = 'changed';
  assert.equal(d.result.start.pledgeId, '7');
  assert.throws(() => applyAction(doc(), { type: 'addChain', start: { kind: 'token', pledgeId: 7 }, target: 4 }), /pledgeId must be a string/);
  const s2 = { kind: 'ship', ship: 2 };
  const e = applyAction(d, { type: 'setStart', chainId: 'c1', start: s2 });
  s2.ship = 3;
  assert.equal(e.plans.chains.c1.start.ship, 2);
  assert.throws(() => applyAction(d, { type: 'setStart', chainId: 'c1', start: { kind: 'token', pledgeId: 7 } }), /pledgeId must be a string/);
  assert.throws(() => applyAction(d, { type: 'setStart', chainId: 'c1', start: { kind: 'bogus' } }), /start must be a token or a ship/);
});
