import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLAINER_STEPS, EXPLAINER_TITLES, shouldShowExplainer, markExplainerSeen } from '../../app/src/lib/view/firstRun.mjs';

const fake = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};
const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('the three explainer sentences are exact and in order', () => {
  assert.deepEqual(EXPLAINER_STEPS, [
    'A CCU upgrades one ship to a more expensive one; you pay the difference.',
    'Chaining small upgrades is often cheaper than one big one.',
    'The cheapest upgrades (Warbonds) mostly appear during sales, so the best price usually means waiting.',
  ]);
});

test('shouldShowExplainer', () => {
  assert.equal(shouldShowExplainer(fake()), true);
  assert.equal(shouldShowExplainer(fake({ 'ccu.explainer.seen': '1' })), false);
  assert.equal(shouldShowExplainer(null), true);
  assert.equal(shouldShowExplainer(throwing), true);
});

test('markExplainerSeen stores the flag and never throws', () => {
  const s = fake();
  markExplainerSeen(s);
  assert.equal(shouldShowExplainer(s), false);
  assert.doesNotThrow(() => markExplainerSeen(throwing));
  assert.doesNotThrow(() => markExplainerSeen(null));
});

test('each tour step has its own title', () => {
  assert.equal(EXPLAINER_TITLES.length, EXPLAINER_STEPS.length);
  assert.equal(new Set(EXPLAINER_TITLES).size, EXPLAINER_TITLES.length);
});

test('the welcome text says what a CCU is with one made-up example, and what the planner does', async () => {
  const { WELCOME_TEXT } = await import('../../app/src/lib/view/firstRun.mjs');
  assert.match(WELCOME_TEXT, /Aurora \$50 → Cutlass \$110 costs \$60/);
  assert.equal(WELCOME_TEXT.match(/Aurora/g).length, 1);
  assert.match(WELCOME_TEXT, /cheapest chain/);
  assert.doesNotMatch(WELCOME_TEXT, /token|pledge/i);
});
