import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedBuyText } from '../../src/logic/whatifText.mjs';

test('a step that is in the plan pays that plan early; the total stays the same', () => {
  assert.equal(plannedBuyText({ cash: 1000, goals: ['Liberator'] }), "Buying now pays $10 of Liberator's plan early. Your total stays the same.");
  assert.equal(plannedBuyText({ cash: 1000, goals: ['Liberator', 'Galaxy'] }), 'Buying now pays $10 of the plans of Liberator and Galaxy early. Your total stays the same.');
  assert.equal(plannedBuyText({ cash: 1000, goals: ['A', 'B', 'C'] }), 'Buying now pays $10 of the plans of A, B and C early. Your total stays the same.');
  assert.equal(plannedBuyText({ cash: 1000, goals: ['A', 'A'] }), "Buying now pays $10 of A's plan early. Your total stays the same.");
});

test('a price lock says it locks, and never says it saves', () => {
  const t = plannedBuyText({ cash: 2000, goals: ['Orion'], lock: true });
  assert.match(t, /locks \$20 of Orion's plan/);
  assert.doesNotMatch(t, /save|cheaper/i);
});

test('no goal, no sentence', () => assert.equal(plannedBuyText({ cash: 1, goals: [] }), null));

test('a step outside the goal\'s reserved chain promises nothing about the total', () => {
  const t = plannedBuyText({ cash: 1000, goals: ['Liberator'], outside: ['Liberator'] });
  assert.equal(t, "This step is in Liberator's proposed chain, not in its reserved chain. See Why? before you buy.");
  assert.doesNotMatch(t, /total stays/);
  assert.match(plannedBuyText({ cash: 1000, goals: ['A', 'B'], outside: ['A'] }), /^This step is in A's proposed chain/);
  assert.match(plannedBuyText({ cash: 1000, goals: ['A', 'B'], outside: ['A', 'B'] }), /proposed chain of A and B, not in their reserved chain/);
  assert.match(plannedBuyText({ cash: 1000, goals: ['A'], outside: ['Z'] }), /total stays the same/, 'a goal that is not listed does not count');
});
