import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compareCcuGame, parseChainFigures } from '../src/logic/ccugameCompare.mjs';
import { NOT_SAVED_CHAINS } from '../src/logic/ccugame.mjs';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { copy, deepFreeze } from './support/ladder.mjs';

const text = fs.readFileSync(new URL('./fixtures/ccugame-compare-chains.json', import.meta.url), 'utf8');
// 1 Pulse $50, 2 M50 $75, 3 Galaxy $100, 4 Orion $150, 5 Liberator $200
const NAMES = { 1: 'Pulse', 2: 'M50', 3: 'Galaxy', 4: 'Orion', 5: 'Liberator', 6: 'Prospector' };
const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000, 6: 12500 };
const ships = new Map(Object.keys(NAMES).map((k) => [Number(k), { id: Number(k), name: NAMES[k], msrp: MSRP[k], concept: false }]));
const offers = [];
for (const f of Object.keys(NAMES)) for (const t of Object.keys(NAMES)) if (MSRP[t] > MSRP[f]) offers.push({ from: Number(f), to: Number(t), kind: 'standard', cash: MSRP[t] - MSRP[f] });

// Orion goal (high) takes the owned Pulse -> Galaxy CCU, so the Galaxy goal pays for it.
function app() {
  const plans = newState();
  const orion = addChain(plans, { base: 1, target: 4, priority: 'high' });
  const galaxy = addChain(plans, { base: 1, target: 3 });
  const liberator = addChain(plans, { base: 1, target: 5 });
  const owned = [copy('x', 1, 3)];
  const data = { ships, offers, owned, lti: [] };
  return { app: { plans, graph: buildGraph(data), data, overrides: { rev: 0, ships: {} }, saleEvents: { rev: 0, events: [] }, expected: offers }, orion, galaxy, liberator };
}

test('the figures of each chain: CCU Game cost, start type and the price of a store start', () => {
  const f = parseChainFigures(text);
  assert.deepEqual(f.map((x) => [x.name, x.ccugameCash, x.fromType, x.startOrigin, x.startCost]), [
    ['Orion', 8000, 'all', 'all-ships', 3000], ['Galaxy', 2500, 'manual', 'hangar', 0], ['Prospector', 7000, 'manual', 'hangar', 0], ['Mystery', 100, 'manual', null, 0],
  ]);
  assert.throws(() => parseChainFigures('{"nope": 1}'), new RegExp(NOT_SAVED_CHAINS));
});

test('matched chains, chains only in CCU Game, goals only in the planner, and the totals', () => {
  const x = app();
  const r = compareCcuGame(deepFreeze(x.app), text);
  const by = Object.fromEntries(r.rows.map((row) => [row.name, row]));

  // Orion: the goal takes the owned Pulse -> Galaxy CCU, then Standard Galaxy -> Orion $50.
  assert.equal(by.Orion.goalId, x.orion.id);
  assert.equal(by.Orion.ourCash, 5000);
  assert.equal(by.Orion.ccugameCash, 8000);
  assert.equal(by.Orion.startCost, 3000);
  assert.equal(by.Orion.ccugameCashNoStart, 5000);
  assert.equal(by.Orion.diff, 0, 'the store start ship is left out of the difference');
  assert.equal(by.Orion.ourAlone, 5000);
  assert.deepEqual(by.Orion.notes, ['CCU Game starts from a store Pulse without LTI (its figure includes $30 for the ship, left out of the difference)']);

  // Galaxy: loses the CCU to Orion, so it pays Standard $50 here; alone it would pay $0.
  assert.equal(by.Galaxy.ourCash, 5000);
  assert.equal(by.Galaxy.ourAlone, 0);
  assert.equal(by.Galaxy.diff, 2500);
  assert.equal(by.Galaxy.startCost, 0);
  assert.equal(by.Galaxy.notes.length, 1);
  assert.match(by.Galaxy.notes[0], /^CCU Game plans each chain separately; ours share your CCUs \(on its own this goal costs \$0 here, \$50 shared\)$/);

  // Only in CCU Game, with a goal-less target and with a ship that is not in the catalog.
  assert.equal(by.Prospector.goalId, null);
  assert.deepEqual(by.Prospector.notes, ['Not in your goals: Prospector']);
  assert.equal(by.Mystery.goalId, null);
  assert.deepEqual(by.Mystery.notes, ['Mystery Ship is not in the ship catalog']);

  // Only in the planner.
  assert.deepEqual(r.onlyOurs, [{ goalId: x.liberator.id, name: 'Liberator', note: 'Not in CCU Game: Liberator' }]);

  assert.deepEqual(r.totals, { matched: 2, ccugame: 7500, startCosts: 3000, ours: 10000, diff: 2500 });
  assert.equal(r.notes.length, 1);
});

test('a goal from a ship matches the chain that starts there; a token goal matches any start', () => {
  const x = app();
  const plans = x.app.plans;
  plans.chains[x.galaxy.id].start = { kind: 'token' };
  x.app.data.lti = [{ pledgeId: '9', ship: 1, name: 'Pulse', paidCents: 3000, msrpCents: 5000 }];
  x.app.graph = buildGraph(x.app.data);
  const r = compareCcuGame(x.app, text);
  const galaxy = r.rows.find((row) => row.name === 'Galaxy');
  assert.equal(galaxy.goalId, x.galaxy.id);
  assert.equal(galaxy.ourStart, 'Pulse');
});

test('each goal matches one chain', () => {
  const x = app();
  const twice = JSON.stringify({ chains: [JSON.parse(text).chains[1], JSON.parse(text).chains[1]] });
  const r = compareCcuGame(x.app, twice);
  assert.deepEqual(r.rows.map((row) => row.goalId !== null), [true, false]);
  assert.deepEqual(r.rows[1].notes, ['Not in your goals: Galaxy']);
});

test('the store-start note needs a known, non-hangar origin', () => {
  const x = app();
  const noOrigin = JSON.stringify({ chains: [{ name: 'Orion', fromShipName: 'Pulse', toShipName: 'Orion', missing: 8000, options: { fromType: 'all' }, chain: [] }] });
  const r = compareCcuGame(x.app, noOrigin);
  assert.deepEqual(r.rows[0].notes.filter((n) => /store/.test(n)), []);
  assert.equal(r.rows[0].ccugameCashNoStart, 8000);
});
