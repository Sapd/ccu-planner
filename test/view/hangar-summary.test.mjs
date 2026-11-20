import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spentCents, savedSummary, copiesInUse, markInUse, unusedSummary } from '../../app/src/lib/view/hangarSummary.mjs';
import { ccuRows, ccuResult, CCU_GROUPS } from '../../app/src/lib/view/ccuTable.mjs';
import { emptySel, toggleOption } from '../../app/src/lib/view/filters.mjs';

const ships = new Map([
  [1, { id: 1, name: 'Alpha', msrp: 5000 }],
  [2, { id: 2, name: 'Beta', msrp: 10000 }],
  [3, { id: 3, name: 'Gamma', msrp: 20000 }],
]);
const copy = (copyId, from, to, o = {}) => ({ copyId, from, to, fromName: 'x', toName: 'y', paid: 3000, edition: 'Standard', giftable: false, meltable: true, reservedBy: null, reservedByName: null, extras: [], ...o });
const pledge = (value) => ({ pledgeId: 1, category: 'ship', ships: [], value });

test('spent adds the USD values of every pledge; missing, gifted and foreign values count as 0', () => {
  assert.equal(spentCents([pledge({ cents: 10000, currency: 'USD' }), pledge({ cents: 2500 }), pledge(null), pledge({ cents: 0, currency: 'USD' }), pledge({ cents: 9999, currency: 'EUR' })]), 12500);
  assert.equal(spentCents([]), 0);
});

test('saved sums the per-copy saving, negatives included, and says when it rests on an estimate', () => {
  // a: Standard offer 4000, paid 3000 -> +1000; b: no offer, 5000 difference, paid 12000 -> -7000 (estimate); c: unknown price
  const rows = ccuRows([copy('a', 1, 2), copy('b', 1, 2, { paid: 12000 }), copy('c', 1, 99)], ships, new Map([['1-2', 4000]]));
  assert.equal(rows[0].saving, 1000);
  assert.equal(rows[1].saving, -8000); // the Standard offer 4000 applies to every 1-2 copy
  const noOffer = ccuRows([copy('a', 1, 2), copy('b', 1, 2, { paid: 12000 }), copy('c', 1, 99)], ships);
  assert.deepEqual(savedSummary(noOffer), { cents: 2000 + -7000, estimated: true, unknown: 1 });
  assert.deepEqual(savedSummary(rows), { cents: 1000 - 8000, estimated: false, unknown: 1 });
  assert.deepEqual(savedSummary([]), { cents: 0, estimated: false, unknown: 0 });
});

test('copies in use: owned steps of every goal, reserved or proposed', () => {
  const j = (...ids) => ({ steps: [...ids.map((id) => ({ state: 'own', step: { copyId: id } })), { state: 'now', step: { copyId: undefined } }] });
  const goals = [{ journey: j('a'), counted: j('b') }, { journey: j('c', 'a') }, { journey: null }];
  assert.deepEqual([...copiesInUse(goals)].sort(), ['a', 'b', 'c']);
  assert.equal(copiesInUse(undefined).size, 0);
});

test('not in use: a copy is in use when reserved or on any goal chain; the count and paid sum ignore unknown prices', () => {
  const base = ccuRows([copy('a', 1, 2), copy('b', 1, 2, { reservedBy: 'g', reservedByName: 'G' }), copy('c', 2, 3, { paid: 500 }), copy('d', 2, 3, { paid: null }), copy('e', 1, 3, { paid: 700 })], ships);
  const rows = markInUse(base, new Set(['c']));
  assert.deepEqual(rows.map((r) => [r.copyId, r.inUse]), [['a', false], ['b', true], ['c', true], ['d', false], ['e', false]]);
  assert.deepEqual(unusedSummary(rows), { count: 3, paid: 3700, unpriced: 1 });
  assert.deepEqual(unusedSummary(markInUse(base, new Set(base.map((r) => r.copyId)))), { count: 0, paid: 0, unpriced: 0 });
});

test('the Use filter: Not in use differs from Not reserved by the copies a proposed chain uses', () => {
  const rows = markInUse(ccuRows([copy('a', 1, 2), copy('b', 1, 2, { reservedBy: 'g', reservedByName: 'G' }), copy('c', 2, 3), copy('d', 1, 3)], ships), new Set(['c']));
  const none = emptySel(CCU_GROUPS);
  const ids = (id) => ccuResult(rows, [], toggleOption(none, 'use', id)).copies.map((r) => r.copyId);
  assert.deepEqual(ids('free'), ['a', 'c', 'd']);
  assert.deepEqual(ids('unused'), ['a', 'd']);
  assert.deepEqual(ids('reserved'), ['b']);
  // Rows never marked: only the reservation counts.
  assert.deepEqual(ccuResult(ccuRows([copy('a', 1, 2), copy('b', 1, 2, { reservedBy: 'g' })], ships), [], toggleOption(none, 'use', 'unused')).copies.map((r) => r.copyId), ['a']);
});
