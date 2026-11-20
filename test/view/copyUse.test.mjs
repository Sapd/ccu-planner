import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyUsers, otherCopies } from '../../app/src/lib/view/copyUse.mjs';

test('copyUsers lists each goal once per copy, from the proposed and the counted chain', () => {
  const step = (copyId) => ({ step: { copyId } });
  const goals = [
    { goalId: 'a', name: 'Liberator', journey: { steps: [step('1'), step(null)] }, counted: { steps: [step('1'), step('2')] } },
    { goalId: 'b', name: 'Odyssey', journey: { steps: [step(2)] } },
  ];
  const users = copyUsers(goals);
  assert.deepEqual(users.get('1'), [{ goalId: 'a', name: 'Liberator' }]);
  assert.deepEqual(users.get('2').map((u) => u.name), ['Liberator', 'Odyssey']);
  assert.equal(users.get('3'), undefined);
});

test('otherCopies lists the same upgrade’s other copies with their goals', () => {
  const owned = [
    { copyId: '1', from: 10, to: 20 }, { copyId: '2', from: 10, to: 20 }, { copyId: '3', from: 10, to: 20 }, { copyId: '4', from: 10, to: 30 },
  ];
  const users = new Map([['2', [{ goalId: 'b', name: 'Odyssey' }]]]);
  assert.deepEqual(otherCopies(owned, { from: 10, to: 20, copyId: '1' }, users), [
    { copyId: '2', goals: [{ goalId: 'b', name: 'Odyssey' }] },
    { copyId: '3', goals: [] },
  ]);
});
