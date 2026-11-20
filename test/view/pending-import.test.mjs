import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makePending, readPending, pendingText, pendingReady, planPending, summarize, addedText, skipReason, NO_CHAINS } from '../../app/src/lib/view/pendingImport.mjs';
import { applyAction } from '../../src/logic/state.mjs';
import { newState } from '../../src/logic/chains.mjs';

const text = fs.readFileSync(new URL('../fixtures/ccugame-saved-chains.json', import.meta.url), 'utf8');
const NAMES = ['Pulse', 'Cutter Rambler', 'Carrack', 'Odyssey', 'Arrastra', '600i Explorer', 'Galaxy', 'Orion', 'Endeavor', 'Ironclad', 'Constellation Mk V Centaurus'];
const ships = new Map(NAMES.map((name, i) => [i + 1, { id: i + 1, name, msrp: 5000 }]));
const ctx = (plans = newState()) => ({ ships, aliases: null, plans, lti: [] });

test('makePending parses the file with the Goals parser and keeps the chains', () => {
  const p = makePending(text, new Date('2026-11-20T10:00:00Z'));
  assert.equal(p.version, 1);
  assert.equal(p.savedAt, '2026-11-20T10:00:00.000Z');
  assert.equal(p.chains.length, 9);
  assert.deepEqual(Object.keys(p.chains[0]).sort(), ['fromName', 'longTerm', 'name', 'toName']);
});

test('makePending refuses a file that is not a saved-chains file, and one with no chains', () => {
  assert.throws(() => makePending('not json'), /not a CCU Game saved-chains file/);
  assert.throws(() => makePending('{"chains":[{"x":1}]}'), /not a CCU Game saved-chains file/);
  assert.throws(() => makePending('{"chains":[]}'), new RegExp(NO_CHAINS));
});

test('readPending accepts what makePending wrote and nothing else', () => {
  const p = makePending(text);
  assert.deepEqual(readPending(JSON.parse(JSON.stringify(p))), p);
  for (const bad of [null, undefined, {}, [], 'x', { version: 2, chains: p.chains }, { version: 1, chains: [] }, { version: 1, chains: [{ name: 1 }] }, { version: 1, chains: 'x' }]) assert.equal(readPending(bad), null);
  assert.equal(readPending({ ...p, savedAt: 5 }).savedAt, null);
});

test('the ready line counts chains', () => {
  assert.equal(pendingText(6), '6 saved chains ready — added as goals after the sync');
  assert.equal(pendingText(1), '1 saved chain ready — added as goals after the sync');
});

test('the import waits for both the store and the hangar', () => {
  const meta = (m) => ({ data: { meta: m } });
  assert.equal(pendingReady(null), false);
  assert.equal(pendingReady(meta({ catalogAt: 'C', hangarAt: null })), false);
  assert.equal(pendingReady(meta({ catalogAt: 'C', hangarAt: 'H' })), true);
});

test('after the sync: new chains are added in one save, unknown ships are reported and never guessed', () => {
  const p = makePending(JSON.stringify({ chains: [
    { name: 'A', fromShipName: 'Carrack', toShipName: 'Odyssey', options: { optimizationTarget: 'longTerm' } },
    { name: 'B', fromShipName: 'Carrack', toShipName: 'Odyssey' },
    { name: 'C', fromShipName: 'Carrack', toShipName: 'Zeta Unknown' },
    { name: 'D', fromShipName: 'Nope Ship', toShipName: 'Galaxy' },
    { name: 'E', fromShipName: 'Pulse', toShipName: 'Pulse' },
  ] }));
  const { rows, count } = planPending(p, ctx());
  assert.equal(count, 1);
  const doc = { plans: newState(), overrides: { rev: 0, ships: {} } };
  const out = applyAction(doc, { type: 'importGoals', rows }, { ships });
  assert.equal(out.result.length, 1);
  assert.equal(Object.values(out.plans.chains)[0].mode, 'watch');
  const s = summarize(rows, out.result.length);
  assert.equal(s.added, 1);
  assert.deepEqual(s.skipped.map((x) => [x.name, x.status]), [['B', 'exists'], ['C', 'needs-ship'], ['D', 'needs-ship'], ['E', 'needs-ship']]);
  assert.equal(s.skipped[0].reason, 'This goal already exists.');
  assert.equal(s.skipped[1].reason, '“Zeta Unknown” is not a ship in the store list.');
  assert.equal(s.skipped[2].reason, '“Nope Ship” is not a ship in the store list.');
  assert.match(s.skipped[3].reason, /starts from the ship it upgrades to/);
  assert.equal(rows.find((r) => r.name === 'C').to, null, 'no ship is guessed');
});

test('running the import again adds nothing: every row is already a goal', () => {
  const p = makePending(text);
  const first = planPending(p, ctx());
  const out = applyAction({ plans: newState(), overrides: { rev: 0, ships: {} } }, { type: 'importGoals', rows: first.rows }, { ships });
  assert.equal(planPending(p, ctx(out.plans)).count, 0);
});

test('summary texts', () => {
  assert.equal(addedText(0), 'No new goals were added from your CCU Game file.');
  assert.equal(addedText(1), 'Added 1 goal from your CCU Game file.');
  assert.equal(addedText(4), 'Added 4 goals from your CCU Game file.');
  assert.equal(skipReason({ status: 'needs-ship', from: 1, to: 2, fromName: 'a', toName: 'b' }), 'A ship could not be matched.');
});
