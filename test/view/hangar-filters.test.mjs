import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySel, selOf, applyFilters, optionCounts, toggleOption, setRange, activeFilters, removeFilter, resetGroup, resetAll, groupActive, resultsText, filtersButtonText, nextSort, ariaSortOf, sortBy } from '../../app/src/lib/view/filters.mjs';

const groups = [
  { id: 'show', label: 'Show', strict: true, defaults: ['a', 'b'], options: [
    { id: 'a', label: 'Owned ships', offLabel: 'Owned hidden', test: (x) => x.k === 'a' },
    { id: 'b', label: 'Goal ships', test: (x) => x.k === 'b' },
  ] },
  { id: 'ins', label: 'Insurance', options: [
    { id: 'lti', label: 'LTI', test: (x) => x.ins === 'lti' },
    { id: '120', label: '120 months', test: (x) => x.ins === '120' },
  ] },
  { id: 'price', label: 'Value', kind: 'range', value: (x) => x.v },
];
const items = [
  { k: 'a', ins: 'lti', v: 5000 }, { k: 'a', ins: '120', v: 10000 }, { k: 'b', ins: null, v: null }, { k: 'a', ins: null, v: 2000 },
];

test('options in a group are alternatives, groups combine, an empty group does not restrict', () => {
  let sel = emptySel(groups);
  assert.equal(applyFilters(items, groups, sel).length, 4);
  sel = toggleOption(sel, 'ins', 'lti');
  assert.equal(applyFilters(items, groups, sel).length, 1);
  sel = toggleOption(sel, 'ins', '120');
  assert.equal(applyFilters(items, groups, sel).length, 2);
  sel = toggleOption(toggleOption(sel, 'ins', 'lti'), 'ins', '120');
  assert.equal(applyFilters(items, groups, sel).length, 4);
});

test('a strict group shows nothing when nothing is ticked', () => {
  let sel = emptySel(groups);
  sel = toggleOption(sel, 'show', 'b');
  assert.equal(applyFilters(items, groups, sel).length, 3);
  sel = toggleOption(sel, 'show', 'a');
  assert.equal(applyFilters(items, groups, sel).length, 0);
});

test('a range keeps items inside it and drops those without a value; blank fields do not filter', () => {
  let sel = setRange(emptySel(groups), 'price', 'min', '30');
  assert.deepEqual(applyFilters(items, groups, sel).map((x) => x.v), [5000, 10000]);
  sel = setRange(sel, 'price', 'max', '60');
  assert.deepEqual(applyFilters(items, groups, sel).map((x) => x.v), [5000]);
  assert.equal(applyFilters(items, groups, setRange(emptySel(groups), 'price', 'min', 'abc')).length, 4);
});

test('option counts leave out the group they belong to', () => {
  let sel = toggleOption(emptySel(groups), 'ins', 'lti');
  const c = optionCounts(items, groups, sel);
  assert.deepEqual(c.ins, { lti: 1, '120': 1 });
  assert.deepEqual(c.show, { a: 1, b: 0 });
});

test('chips show only what differs from the start; removing one restores it', () => {
  let sel = emptySel(groups);
  assert.deepEqual(activeFilters(groups, sel), []);
  sel = toggleOption(sel, 'show', 'a');
  sel = toggleOption(sel, 'ins', 'lti');
  sel = setRange(sel, 'price', 'min', '40');
  const chips = activeFilters(groups, sel);
  assert.deepEqual(chips.map((c) => [c.kind, c.label]), [['off', 'Owned hidden'], ['on', 'LTI'], ['range', 'Value $40 or more']]);
  for (const c of chips) sel = removeFilter(groups, sel, c);
  assert.deepEqual([...sel.show].sort(), ['a', 'b']);
  assert.deepEqual(activeFilters(groups, sel), []);
});

test('reset a group, reset all and which groups say (reset)', () => {
  let sel = toggleOption(toggleOption(emptySel(groups), 'ins', 'lti'), 'show', 'b');
  assert.equal(groupActive(groups, sel, 'ins'), true);
  assert.equal(groupActive(groups, sel, 'price'), false);
  sel = resetGroup(groups, sel, 'ins');
  assert.equal(groupActive(groups, sel, 'ins'), false);
  assert.equal(groupActive(groups, sel, 'show'), true);
  assert.deepEqual(resetAll(groups), emptySel(groups));
});

test('a stored selection that does not fit the groups falls back to the start state', () => {
  assert.deepEqual(selOf(null, groups), emptySel(groups));
  const s = selOf({ show: ['a', 'zzz'], ins: 'oops', price: { min: 5 } }, groups);
  assert.deepEqual(s.show, ['a']);
  assert.deepEqual(s.ins, []);
  assert.deepEqual(s.price, { min: '5', max: '' });
});

test('texts and sorting', () => {
  assert.equal(resultsText(23, 197, 'upgrades'), 'Showing 23 of 197');
  assert.equal(resultsText(197, 197, 'upgrades'), '197 upgrades');
  assert.equal(resultsText(1, 1, 'upgrades'), '1 upgrade');
  assert.equal(filtersButtonText(0), 'Filters');
  assert.equal(filtersButtonText(2), 'Filters (2 active)');
  assert.deepEqual(nextSort(null, 'paid', 'desc'), { key: 'paid', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'paid', dir: 'desc' }, 'paid', 'desc'), { key: 'paid', dir: 'asc' });
  assert.equal(nextSort({ key: 'paid', dir: 'asc' }, 'paid', 'desc'), null);
  assert.equal(ariaSortOf({ key: 'paid', dir: 'asc' }, 'paid'), 'ascending');
  assert.equal(ariaSortOf({ key: 'paid', dir: 'asc' }, 'to'), 'none');
  const rows = [{ n: 'b', v: 2 }, { n: 'x', v: null }, { n: 'a', v: 9 }, { n: 'c', v: 2 }];
  assert.deepEqual(sortBy(rows, { key: 'v', dir: 'desc' }, (r) => r.v).map((r) => r.n), ['a', 'b', 'c', 'x']);
  assert.deepEqual(sortBy(rows, { key: 'v', dir: 'asc' }, (r) => r.v).map((r) => r.n), ['b', 'c', 'a', 'x']);
  assert.deepEqual(sortBy(rows, { key: 'n', dir: 'asc' }, (r) => r.n).map((r) => r.n), ['a', 'b', 'c', 'x']);
  assert.equal(sortBy(rows, null, () => 0), rows);
});
