import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hangarHealth } from '../../app/src/lib/view/health.mjs';

const goal = (name, targetId, steps = []) => ({ goalId: name, name, targetId, journey: { steps: steps.map(([from, to, state]) => ({ state, step: { from, to } })) } });

test('no banner when every hangar upgrade was read', () => {
  assert.equal(hangarHealth({ review: [], owned: [{}] }, [goal('Liberator', 224)]), null);
  assert.equal(hangarHealth(null, []), null);
});

test('names the goals that buy into or out of a ship an unreadable upgrade touches, or target it', () => {
  const data = { review: [{ pledgeId: 9, fromShip: null, toShip: 224 }, { pledgeId: 10, fromShip: 50, toShip: null }], owned: [{}, {}, {}] };
  const h = hangarHealth(data, [
    goal('Liberator', 224),
    goal('Carrack', 176, [[50, 60, 'now']]),
    goal('Polaris', 300, [[50, 60, 'own'], [60, 300, 'wait']]), // only an owned step touches ship 50
  ]);
  assert.deepEqual(h.goals, ['Liberator', 'Carrack']);
  assert.equal(h.key, '10,9'); // the same set of upgrades gives the same key, so a dismissal holds until it changes
  assert.equal(h.text, '2 of 5 upgrades in your hangar could not be read. Plans for Liberator, Carrack may suggest buying an upgrade you already own.');
});

test('without a resolvable side it still warns, without naming goals', () => {
  const h = hangarHealth({ review: [{ fromShip: null, toShip: null }], owned: [] }, [goal('Liberator', 224)]);
  assert.deepEqual(h.goals, []);
  assert.equal(h.text, '1 upgrade in your hangar could not be read. A plan may suggest buying an upgrade you already own.');
});
