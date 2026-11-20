import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalLabel } from '../../src/logic/ships.mjs';

test('a goal is labelled by its target ship, falling back to the stored name, then a plain word', () => {
  const ships = new Map([[3, { id: 3, name: 'Galaxy' }]]);
  assert.equal(goalLabel({ id: 'c1', name: 'Pulse to Galaxy', target: 3 }, ships), 'Galaxy');
  assert.equal(goalLabel({ id: 'c1', name: 'Old name', target: 9 }, ships), 'Old name');
  assert.equal(goalLabel({ id: 'c1', target: 9 }, ships), 'a goal');
});
