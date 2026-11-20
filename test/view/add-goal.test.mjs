import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterState, sampleExample, endpointsText } from '../../app/src/lib/view/addGoal.mjs';

test('the form knows before saving whether the planner would find a starting ship', () => {
  assert.equal(starterState({ fixed: false, poolCount: 0 }), 'none');
  assert.equal(starterState({ fixed: false, poolCount: 2 }), 'auto');
  assert.equal(starterState({ fixed: true, poolCount: 0 }), 'chosen', 'choosing the ship yourself needs no LTI ship');
});

test('the sample offers the working Alpha to Beta example, other data does not', () => {
  const ships = new Map([[1, { id: 1, name: 'Alpha' }], [2, { id: 2, name: 'Beta' }], [3, { id: 3, name: 'Gamma' }]]);
  assert.deepEqual(sampleExample(ships), { base: 1, target: 2 });
  assert.equal(sampleExample(new Map([[7, { id: 7, name: 'Carrack' }]])), null);
});

test('the endpoints line names both ends and where the start comes from', () => {
  assert.equal(endpointsText({ state: 'chosen', startName: 'Alpha', targetName: 'Beta' }), 'Start Alpha (your choice) → goal Beta');
  assert.equal(endpointsText({ state: 'auto', startPoolName: 'Pulse', targetName: 'Beta' }), 'Start Pulse (picked by the planner) → goal Beta');
  assert.equal(endpointsText({ state: 'none', targetName: 'Beta' }), 'No starting ship yet → goal Beta');
  assert.equal(endpointsText({ state: 'auto', targetName: null }), null);
});
