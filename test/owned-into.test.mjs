import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedInto } from '../src/logic/ownedInto.mjs';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { deepFreeze } from './support/ladder.mjs';

// 1 = Start, 2 = Carrack, 3 = Orion (concept), 4 = Ironclad
const NAMES = { 1: 'Start', 2: 'Carrack', 3: 'Orion', 4: 'Ironclad' };
const ships = new Map([1, 2, 3, 4].map((id) => [id, { id, name: NAMES[id], msrp: id * 5000, concept: id === 3 }]));
const cp = (copyId, from, to, cents = 100) => ({ copyId, from, to, paid: { cents }, giftable: copyId === 'c-it3', meltable: true });

function app() {
  const offers = [
    { kind: 'standard', from: 2, to: 3, cash: 5000 }, { kind: 'standard', from: 1, to: 4, cash: 8000 }, { kind: 'standard', from: 1, to: 2, cash: 2000 },
  ];
  const owned = [cp('c-sc', 1, 2), cp('c-it', 4, 3), cp('c-it2', 4, 3), cp('c-it3', 4, 3, 300)];
  const plans = newState();
  const orion = addChain(plans, { base: 1, target: 3 });
  const other = addChain(plans, { base: 4, target: 3, priority: 'high' });
  const data = { ships, offers, owned, lti: [] };
  return { app: { plans, graph: buildGraph(data), data, overrides: { rev: 0, ships: {} }, saleEvents: null, expected: offers }, orion, other };
}

test('copies into a ship: used by a goal, covering a price rise, unused', () => {
  const x = app();
  const r = ownedInto(deepFreeze(x.app), 3, { day: '2026-11-20' });
  assert.equal(r.total, 3);
  assert.equal(r.groups.length, 1);
  const [g] = r.groups;
  assert.deepEqual([g.from, g.fromName, g.count], [4, 'Ironclad', 3]);
  assert.deepEqual(g.copies.map((c) => [c.copyId, c.use.kind, c.use.text]), [
    ['c-it', 'used', 'used by Orion'], // by the high-priority goal Ironclad -> Orion (goals are named by their target ship)
    ['c-it2', 'cover', "covers Orion's price rise"],
    ['c-it3', 'unused', 'unused'],
  ]);
  assert.equal(g.copies[2].paid, 300);
  assert.equal(g.copies[2].giftable, true);
});

test('the goal being looked at reads "used on this route"', () => {
  const x = app();
  const r = ownedInto(x.app, 3, { goalId: x.other.id, day: '2026-11-20' });
  assert.equal(r.groups[0].copies[0].use.text, 'used on this route');
  assert.equal(r.groups[0].copies[0].use.goalId, x.other.id);
});

test('a ship nothing is owned into has no groups', () => {
  assert.deepEqual(ownedInto(app().app, 1, { day: '2026-11-20' }), { shipId: 1, total: 0, groups: [] });
});

test('a copy a goal route uses is used, with the goal named by its target ship', () => {
  const x = app();
  const r = ownedInto(x.app, 2, { day: '2026-11-20' });
  assert.deepEqual(r.groups.map((g) => [g.fromName, g.copies.map((c) => [c.copyId, c.use.text])]), [['Start', [['c-sc', 'used by Orion']]]]);
});
