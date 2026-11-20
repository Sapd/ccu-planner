import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staircase } from '../../app/src/lib/view/staircase.mjs';
import { describeDiff } from '../../src/logic/describe.mjs';

const ships = new Map([
  [1, { id: 1, name: 'Pulse', msrp: 3000 }],
  [2, { id: 2, name: '325a', msrp: 7000 }],
  [3, { id: 3, name: 'Spartan', msrp: 8000 }],
  [4, { id: 4, name: 'M50', msrp: 10000 }],
]);
const step = (from, to, kind, cash = 0) => ({ from, to, kind, cash });

test('a 3-step route gives 4 points and the step kinds', () => {
  const route = { steps: [step(1, 2, 'standard', 4000), step(2, 3, 'owned'), step(3, 4, 'warbond', 1500)] };
  const s = staircase(route, ships);
  assert.equal(s.empty, false);
  assert.deepEqual(s.points.map((p) => p.y), [3000, 7000, 8000, 10000]);
  assert.deepEqual(s.points.map((p) => p.x), [0, 1, 2, 3]);
  assert.deepEqual(s.points.map((p) => p.ship), ['Pulse', '325a', 'Spartan', 'M50']);
  assert.deepEqual(s.segments.map((g) => g.kind), ['standard', 'owned', 'warbond']);
  assert.deepEqual(s.segments.map((g) => [g.from, g.to]), [[0, 1], [1, 2], [2, 3]]);
});

test('null and zero-step routes are empty', () => {
  assert.equal(staircase(null, ships).empty, true);
  const z = staircase({ steps: [] }, ships);
  assert.equal(z.empty, true);
  assert.deepEqual(z.points, []);
});

test('an unknown ship id is shown as #<id>', () => {
  const s = staircase({ steps: [step(1, 99, 'standard')] }, ships);
  assert.equal(s.points[1].ship, 'unknown ship');
});

test('describeDiff wording', () => {
  assert.equal(describeDiff({ kind: 'same-path', cashDelta: -1000, released: [], claimed: [] }), 'Same path · $10 less cash');
  assert.equal(describeDiff({ kind: 'no-route', cashDelta: null }), 'Blocked · no route');
  assert.equal(describeDiff({ kind: 'new', cashDelta: null }), 'New plan');
});

test('chartSeries splits lines per kind and breaks non-adjacent segments', async () => {
  const { chartSeries } = await import('../../app/src/lib/view/staircase.mjs');
  const route = { steps: [step(1, 2, 'standard'), step(2, 3, 'owned'), step(3, 4, 'standard')] };
  const c = chartSeries(staircase(route, ships));
  assert.deepEqual(c.owned, [[1, 7000], [2, 8000]]);
  assert.deepEqual(c.standard, [[0, 3000], [1, 7000], [2, null], [2, 8000], [3, 10000]]);
});
