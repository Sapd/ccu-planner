import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposedLabel, reservedLabel, proposedEffectText, comparingBanner, chainChanges, changeLines } from '../src/logic/chainChoice.mjs';
import { plannedTotalText, PLANNED_TOTAL_BASIS } from '../src/logic/describe.mjs';

const names = { 1: 'Pulse', 2: 'Syulen', 3: 'Spartan', 4: 'Reliant', 5: '600i' };
const name = (id) => names[id];
const step = (kind, from, to, cash = 0, copyId) => ({ kind, from, to, cash, ...(copyId ? { copyId } : {}) });

test('the two chains are named with their new cash', () => {
  assert.equal(proposedLabel(4500), 'Proposed chain · $45');
  assert.equal(reservedLabel(5000), 'Reserved chain · $50');
});

test('the effect sentence says "Saves" only when the new cash really drops', () => {
  assert.equal(proposedEffectText(5000, 4500), 'Saves $5 in new cash. Your reserved chain stays in place until you switch.');
  assert.equal(proposedEffectText(4500, 5000), 'Needs $5 more new cash. Your reserved chain stays in place until you switch.');
  const same = proposedEffectText(5000, 5000);
  assert.equal(same, 'Needs the same new cash with different steps. Your reserved chain stays in place until you switch.');
  assert.doesNotMatch(same, /sav|cheaper|less/i);
  assert.equal(proposedEffectText(null, 5000), 'Your reserved chain stays in place until you switch.');
});

test('chainChanges lists dropped and added steps and the copies released or newly reserved', () => {
  const reserved = { steps: [step('owned', 1, 2, 0, 'k1'), step('standard', 2, 3, 4000), step('owned', 3, 5, 0, 'k2')] };
  const proposed = { steps: [step('owned', 1, 2, 0, 'k1'), step('warbond', 2, 3, 3500), step('standard', 3, 5, 1000)] };
  const c = chainChanges(reserved, proposed);
  assert.deepEqual(c.dropped.map((s) => `${s.kind}:${s.from}-${s.to}`), ['standard:2-3', 'owned:3-5']);
  assert.deepEqual(c.added.map((s) => `${s.kind}:${s.from}-${s.to}`), ['warbond:2-3', 'standard:3-5']);
  assert.deepEqual(c.released.map((s) => s.copyId), ['k2']);
  assert.deepEqual(c.claimed, []);
  assert.deepEqual(changeLines(c, name), [
    'Dropped: Syulen → Spartan (Standard $40)',
    'Dropped: Spartan → 600i (owned upgrade, free for other goals)',
    'Added: Syulen → Spartan (Warbond $35)',
    'Added: Spartan → 600i (Standard $10)',
  ]);
});

test('a same-path chain with a different copy lists the copy swap and nothing else', () => {
  const reserved = { steps: [step('owned', 1, 2, 0, 'k1')] };
  const proposed = { steps: [step('owned', 1, 2, 0, 'k9')] };
  const c = chainChanges(reserved, proposed);
  assert.deepEqual(c.dropped, []);
  assert.deepEqual(changeLines(c, name), ['Released: the copy of Pulse → Syulen you own (free for other goals)', 'Reserved: a different copy of Pulse → Syulen']);
  assert.deepEqual(chainChanges(null, proposed), { dropped: [], added: [], released: [], claimed: [] });
});

test('plannedTotalText names the goals the total leaves out', () => {
  const g = (name, status) => ({ name, status });
  assert.equal(plannedTotalText(2000, [g('Gamma', 'wait'), g('Beta', 'no-token')]), 'Planned total · $20 for 1 of 2 goals. Beta needs a starting ship.');
  assert.equal(plannedTotalText(2000, [g('Gamma', 'wait'), g('Beta', 'buy')]), 'Planned total · $20');
  assert.equal(plannedTotalText(0, [g('A', 'no-route'), g('B', 'no-token'), g('C', 'done')]), 'Planned total · $0 for 1 of 3 goals. A has no route. B needs a starting ship.');
  assert.match(PLANNED_TOTAL_BASIS, /reserved at/);
});

test('the banner says "Cheaper chain" only when the new cash really drops', async () => {
  const { proposedBanner } = await import('../src/logic/chainChoice.mjs');
  assert.deepEqual(proposedBanner(5000, 4500, 4), { tone: 'better', text: 'Cheaper chain: $45 instead of $50 · 4 steps differ' });
  assert.equal(proposedBanner(5000, 4500, 1).text, 'Cheaper chain: $45 instead of $50 · 1 step differs');
  assert.deepEqual(proposedBanner(4500, 5000), { tone: 'worse', text: 'A different chain is proposed: $50 instead of $45' });
  const same = proposedBanner(5000, 5000, 2);
  assert.equal(same.tone, 'same');
  assert.doesNotMatch(same.text, /cheap|sav|less/i);
});

test('while comparing, the banner says which chain is shown', () => {
  assert.equal(comparingBanner(4500), 'Showing proposed chain · $45');
});
