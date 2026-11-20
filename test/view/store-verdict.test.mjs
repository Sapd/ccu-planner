import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeVerdicts } from '../../app/src/lib/view/store.mjs';
import { locateStep } from '../../app/src/lib/view/focus.mjs';
import { offerTile } from '../../src/logic/whatifText.mjs';
import { checkOffer } from '../../src/logic/offerCheck.mjs';
import { setup } from '../support/ladder.mjs';

const st = (state, from, to, kind = 'warbond') => ({ state, step: { from, to, kind } });
const goal = (goalId, name, steps) => ({ goalId, name: `${name} chain`, targetName: name, journey: { steps } });

test('a Warbond step Today buys is "In your plan"; a waiting or Standard step only "Helps a goal"; an owned step needs no offer', () => {
  const v = storeVerdicts([
    goal('a', 'Liberator', [st('own', 1, 2), st('now', 2, 3), st('wait', 3, 4)]),
    goal('b', 'Odyssey', [st('now', 5, 3, 'standard'), st('wait', 6, 7)]),
  ]);
  assert.equal(v.ships.get(2), undefined, 'the owned step into ship 2 needs no offer');
  assert.deepEqual(v.ships.get(3), { verdict: 'plan', goals: [{ goalId: 'a', name: 'Liberator' }, { goalId: 'b', name: 'Odyssey' }] });
  assert.equal(v.ships.get(4).verdict, 'helps');
  assert.equal(v.ships.get(7).verdict, 'helps');
  assert.equal(v.pairs.get('2-3').verdict, 'plan');
  assert.equal(v.pairs.get('5-3'), undefined, 'only Warbond steps mark a source row');
});

test('locateStep names the collapsed run that holds a step', () => {
  const steps = [st('wait', 1, 2), st('own', 2, 3), st('own', 3, 4), st('own', 4, 5), st('wait', 5, 6)];
  const groups = [{ kind: 'step', index: 0 }, { kind: 'owned-run', from: 1, to: 3, count: 3 }, { kind: 'step', index: 4 }];
  assert.deepEqual(locateStep(groups, steps, 5, 6), { index: 4, run: null });
  assert.deepEqual(locateStep(groups, steps, 3, 4), { index: 2, run: { from: 1, to: 3 } });
  assert.equal(locateStep(groups, steps, 9, 9), null);
});

test('the offer tile gives one verdict and the replaced purchase', () => {
  // Pulse -> Carrack is a $50 Standard step; Hercules -> Carrack as a $10 Warbond saves $15 after its price.
  const { app } = setup({ goals: [{ base: 1, target: 3 }] });
  const good = offerTile(checkOffer(app, { from: 2, to: 3, kind: 'warbond', cash: 1000 }));
  assert.equal(good.tone, 'good');
  assert.equal(good.head, 'Worth it · saves $15');
  assert.match(good.text, /^Save \$15 overall\./);
  const none = offerTile(checkOffer(app, { from: 4, to: 5, kind: 'warbond', cash: 1000 }));
  assert.deepEqual([none.tone, none.head], ['neutral', 'Not needed']);
});
