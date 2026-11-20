import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSavedChains, importRows } from '../src/logic/ccugame.mjs';
import { applyAction } from '../src/logic/state.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';

const text = fs.readFileSync(new URL('./fixtures/ccugame-saved-chains.json', import.meta.url), 'utf8');
const NAMES = ['Pulse', 'Cutter Rambler', 'Carrack', 'Odyssey', 'Arrastra', '600i Explorer', 'Galaxy', 'Orion', 'Endeavor', 'Ironclad', 'Constellation Mk V Centaurus'];
const ships = new Map(NAMES.map((name, i) => [i + 1, { id: i + 1, name, msrp: 5000 }]));
const id = (n) => NAMES.indexOf(n) + 1;
const lti = ['Pulse', 'Cutter Rambler'].map((n, i) => ({ pledgeId: String(100 + i), ship: id(n), name: n, paidCents: 3000, msrpCents: 5000 }));
const token = (target) => ({ start: { kind: 'token' }, target: id(target) });

function plansDoc() {
  const plans = newState();
  for (const t of ['600i Explorer', 'Arrastra', 'Galaxy']) addChain(plans, { ...token(t) });
  addChain(plans, { start: { kind: 'ship', ship: id('Carrack') }, target: id('Odyssey') });
  return plans;
}
const ctx = (plans = plansDoc()) => ({ ships, aliases: null, plans, lti });
const rows = (plans) => importRows(parseSavedChains(text), ctx(plans));

test('the real export gives 4 existing and 5 new rows', () => {
  const r = rows();
  assert.equal(r.length, 9);
  assert.equal(r.filter((x) => x.status === 'exists').length, 4);
  assert.equal(r.filter((x) => x.status === 'new').length, 5);
});

test('start kinds follow the token pool; every row is watch', () => {
  const r = rows();
  assert.equal(r.find((x) => x.name === 'Carrack -> Odyssey').start.kind, 'ship');
  for (const x of r.filter((x) => /^(Pulse|Cutter Rambler)$/.test(x.fromName))) assert.equal(x.start.kind, 'token');
  assert.ok(r.every((x) => x.mode === 'watch'));
});

test('importGoals adds only new rows in one save, then everything exists', () => {
  const doc = { plans: plansDoc(), overrides: { rev: 0, ships: {} } };
  const out = applyAction(doc, { type: 'importGoals', rows: rows(doc.plans) }, { ships });
  assert.equal(out.result.length, 5);
  assert.equal(Object.keys(out.plans.chains).length, 9);
  assert.equal(out.plans.chains[out.result[0]].name, 'Cutter Rambler -> Constellation Mk V Centaurus');
  assert.ok(importRows(parseSavedChains(text), ctx(out.plans)).every((x) => x.status === 'exists'));
});

test('a chain listed twice gives one new and one exists', () => {
  const t = JSON.stringify({ chains: [0, 1].map(() => ({ name: 'X', fromShipName: 'Pulse', toShipName: 'Orion', options: { optimizationTarget: 'cost' } })) });
  const r = importRows(parseSavedChains(t), ctx());
  assert.deepEqual(r.map((x) => x.status), ['new', 'exists']);
  assert.equal(r[0].mode, 'finish');
});

test('files that are not saved chains throw the exact message', () => {
  for (const bad of ['{"foo":1}', 'hello', '{"chains":[{"fromShipName":"A"}]}']) {
    assert.throws(() => parseSavedChains(bad), { message: 'This is not a CCU Game saved-chains file' });
  }
});

test('an unknown ship name needs a ship', () => {
  const t = JSON.stringify({ chains: [{ name: 'A', fromShipName: 'Pulse', toShipName: 'Nope' }, { name: 'B', fromShipName: 'Nope', toShipName: 'Orion' }] });
  const r = importRows(parseSavedChains(t), ctx());
  assert.deepEqual(r.map((x) => x.status), ['needs-ship', 'needs-ship']);
  assert.equal(r[0].to, null);
  assert.equal(r[1].from, null);
});

const one = (from, to, plans = plansDoc(), extra = {}) =>
  importRows(parseSavedChains(JSON.stringify({ chains: [{ name: 'N', fromShipName: from, toShipName: to }] })), { ...ctx(plans), ...extra });

test('restatus turns a fixed needs-ship row into new or exists', async () => {
  const { restatus } = await import('../src/logic/ccugame.mjs');
  const [r] = one('Nope', 'Orion');
  assert.equal(r.status, 'needs-ship');
  const fixedNew = restatus([{ ...r, from: id('Orion') + 1 }], ctx())[0];
  assert.equal(fixedNew.status, 'new');
  const [e] = one('Nope', 'Odyssey');
  assert.equal(restatus([{ ...e, from: id('Carrack') }], ctx())[0].status, 'exists');
});

test('a ship start equal to the target stays needs-ship', async () => {
  const { restatus } = await import('../src/logic/ccugame.mjs');
  assert.equal(one('Orion', 'Orion')[0].status, 'needs-ship');
  const [r] = one('Nope', 'Orion');
  assert.equal(restatus([{ ...r, from: id('Orion') }], ctx())[0].status, 'needs-ship');
});

test('an alias to a ship missing from the catalog needs a ship', () => {
  const aliases = { items: { a: { itemName: 'Ghost', shipId: 999 }, b: { itemName: 'Old Orion', shipId: id('Orion') } } };
  const [g] = one('Ghost', 'Orion', plansDoc(), { aliases });
  assert.equal(g.from, null);
  assert.equal(g.status, 'needs-ship');
  assert.equal(one('Old Orion', 'Odyssey', plansDoc(), { aliases })[0].from, id('Orion'));
});

test('importGoals rejects crafted rows and skips rows that are not new', () => {
  const doc = { plans: newState(), overrides: { rev: 0, ships: {} } };
  const row = (o) => ({ name: 'X', status: 'new', mode: 'watch', start: { kind: 'ship', ship: 1 }, to: 2, ...o });
  assert.throws(() => applyAction(doc, { type: 'importGoals', rows: [row({ to: 1 })] }, { ships }), /differ/);
  assert.throws(() => applyAction(doc, { type: 'importGoals', rows: [row({ to: 999 })] }, { ships }), /unknown ship/);
  const out = applyAction(doc, { type: 'importGoals', rows: [row({ status: 'exists' }), row({ status: 'needs-ship' }), row({ name: 7 })] }, { ships });
  assert.equal(out.result.length, 1);
  assert.equal(out.plans.chains[out.result[0]].name, ships.get(2).name);
});
