import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccuRows, groupCcuPairs, ccuResult, CCU_GROUPS, ccuSortValue } from '../../app/src/lib/view/ccuTable.mjs';
import { ownedCards, goalCards, fleetItems, fleetCountText, FLEET_GROUPS, insuranceKind, insuranceLabel, originLine } from '../../app/src/lib/view/fleet.mjs';
import { otherPledges, searchPledges, OTHER_GROUPS } from '../../app/src/lib/view/otherPledges.mjs';
import { applyFilters, emptySel, toggleOption } from '../../app/src/lib/view/filters.mjs';

const ships = new Map([
  [1, { id: 1, name: 'Alpha', msrp: 5000, concept: false }],
  [2, { id: 2, name: 'Beta', msrp: 10000, concept: false }],
  [3, { id: 3, name: 'Gamma', msrp: 20000, concept: true }],
]);
const copy = (copyId, from, to, o = {}) => ({ copyId, from, to, fromName: ships.get(from)?.name ?? 'unknown ship', toName: ships.get(to)?.name ?? 'unknown ship', paid: 3000, edition: 'Standard', giftable: false, meltable: true, reservedBy: null, reservedByName: null, extras: [], ...o });

test('ccuRows adds list values, saving, percent and the warbond marker; unknown inputs stay unknown', () => {
  const [a, b, c, d] = ccuRows([copy('a', 1, 2, { edition: 'Warbond' }), copy('b', 1, 2, { paid: 5000 }), copy('c', 2, 3, { paid: 12000 }), copy('d', 1, 99, { paid: null })], ships);
  assert.deepEqual([a.fromValue, a.toValue, a.value, a.saving, a.pct, a.warbond], [5000, 10000, 5000, 2000, 40, true]);
  assert.deepEqual([b.saving, b.pct, b.warbond], [0, 0, false]);
  assert.equal(ccuRows([copy('w', 1, 2, { edition: 'Warbond', paid: 6000 })], ships)[0].warbond, true);
  assert.deepEqual([c.saving, c.stage, c.warbond], [-2000, 'concept', false]);
  assert.deepEqual([d.value, d.saving, d.pct, d.warbond, d.stage], [null, null, null, false, null]);
  assert.equal(ccuRows([copy('e', 1, 2, { paid: null })], ships)[0].saving, null);
});

test('copies of different editions are separate rows', () => {
  const g = groupCcuPairs(ccuRows([copy('a', 1, 2, { edition: 'Warbond' }), copy('b', 1, 2)], ships));
  assert.deepEqual(g.map((x) => [x.edition, x.warbond]), [['Warbond', true], ['Standard', false]]);
});

test('identical copies group even when only some are reserved; the group counts reserved copies by goal', () => {
  const rows = ccuRows([copy('a', 1, 2), copy('b', 1, 2, { reservedBy: 'g1', reservedByName: 'Gamma' }), copy('c', 1, 2), copy('d', 1, 2, { paid: 100 })], ships);
  const groups = groupCcuPairs(rows);
  assert.equal(groups.length, 2);
  const g = groups[0];
  assert.deepEqual([g.count, g.reservedCount, g.reservedBy, g.copyId, g.copyIds], [3, 1, null, 'a', ['a', 'b', 'c']]);
  assert.deepEqual(g.goals, [{ id: 'g1', name: 'Gamma', count: 1 }]);
  const whole = groupCcuPairs(ccuRows([copy('x', 1, 2, { reservedBy: 'g1', reservedByName: 'Gamma' })], ships))[0];
  assert.deepEqual([whole.reservedBy, whole.reservedByName], ['g1', 'Gamma']);
  const two = groupCcuPairs(ccuRows([copy('x', 1, 2, { reservedBy: 'g1', reservedByName: 'G' }), copy('y', 1, 2, { reservedBy: 'g2', reservedByName: 'H' })], ships))[0];
  assert.deepEqual([two.reservedBy, two.reservedCount, two.goals.length], [null, 2, 2]);
});

test('ccuResult: filters, search, review and the shown/total count', () => {
  const rows = ccuRows([copy('a', 1, 2), copy('b', 2, 3, { paid: 12000, reservedBy: 'g', reservedByName: 'G' }), copy('c', 1, 2, { giftable: true })], ships);
  const review = [{ pledgeId: 9, name: 'Odd', reason: 'unknown' }];
  const none = emptySel(CCU_GROUPS);
  let r = ccuResult(rows, review, none);
  assert.deepEqual([r.shown, r.total, r.groups.length, r.showReview], [3, 3, 3, false]);
  r = ccuResult(rows, review, toggleOption(none, 'use', 'reserved'));
  assert.deepEqual(r.copies.map((x) => x.copyId), ['b']);
  r = ccuResult(rows, review, toggleOption(none, 'saving', 'negative'));
  assert.deepEqual(r.copies.map((x) => x.copyId), ['b']);
  r = ccuResult(rows, review, toggleOption(none, 'use', 'review'));
  assert.deepEqual([r.copies.length, r.review.length, r.shown, r.total], [0, 1, 1, 4]);
  r = ccuResult(rows, review, toggleOption(toggleOption(none, 'use', 'review'), 'use', 'free'));
  assert.deepEqual([r.copies.length, r.review.length], [2, 1]);
  r = ccuResult(rows, review, none, 'gamma');
  assert.deepEqual(r.copies.map((x) => x.copyId), ['b']);
  r = ccuResult(rows, review, toggleOption(none, 'stage', 'concept'));
  assert.deepEqual(r.copies.map((x) => x.copyId), ['b']);
});

test('ccu sort values: names, counts and numbers; missing numbers are null', () => {
  const [g] = groupCcuPairs(ccuRows([copy('a', 1, 2), copy('b', 1, 2)], ships));
  assert.deepEqual(['from', 'to', 'x', 'reserved', 'paid', 'value', 'pct'].map((k) => ccuSortValue(g, k)), ['Alpha', 'Beta', 2, 0, 3000, 5000, 40]);
  assert.equal(ccuSortValue({ value: null }, 'value'), null);
});

test('insurance kind and label', () => {
  assert.deepEqual(['Lifetime Insurance', '120 Months Insurance', '6 Months Insurance', null].map(insuranceKind), ['lti', '120', 'less', null]);
  assert.deepEqual(['Lifetime Insurance', '120 Months Insurance', null].map(insuranceLabel), ['LTI', '120 months', null]);
});

const pledge = (id, name, o = {}) => ({ pledgeId: id, name, category: 'ship', giftable: false, reclaimable: false, upgraded: false, insurance: null, ships: [], items: [], ...o });

test('owned cards say where the ship came from, its insurance, stage and whether it can start a goal', () => {
  const pledges = [pledge('1', 'Standalone Ship - Beta', { giftable: true }), pledge('2', 'Standalone Ship - Alpha', { upgraded: true })];
  const fleet = [
    { key: 'id:2', shipId: 2, name: 'Beta', manufacturer: 'M', count: 1, pledgeIds: ['1'], insurance: 'Lifetime Insurance', lti: true },
    { key: 'id:3', shipId: 3, name: 'Gamma', manufacturer: null, count: 2, pledgeIds: ['2', '3'], insurance: '120 Months Insurance', lti: false },
  ];
  const [b, g] = ownedCards(fleet, pledges, ships, new Set(['1']));
  assert.deepEqual([b.line, b.insurance, b.insuranceKind, b.stage, b.starting, b.giftable, b.count], ['Standalone ship', 'LTI', 'lti', 'flight', true, true, 1]);
  assert.deepEqual([g.line, g.stage, g.starting, g.giftable, g.count, g.pledgeId, g.upgraded], ['Alpha → Gamma', 'concept', false, false, 2, '2', true]);
  assert.equal(originLine(null, 'X'), null);
  assert.equal(originLine(pledge('9', 'Standalone Ships - Pioneer - 10 Year'), 'Pioneer'), 'Pioneer - 10 Year');
  assert.equal(originLine(pledge('9', 'Package - Avenger Titan Starter Pack'), 'Avenger Titan'), 'Package - Avenger Titan Starter Pack');
});

test('goal cards say how far the chain is; fleet filters and search', () => {
  const goal = (o) => ({ goalId: 'c1', name: 'G', targetId: 3, targetName: 'Gamma', startLine: 'Starts from your Alpha', status: 'wait', cash: 100, countedCash: 100, journey: { bar: { own: 2, wait: 1 }, steps: [0, 0, 0] }, ...o });
  const tags = [goal({}), goal({ status: 'done', journey: { bar: { own: 3 }, steps: [0, 0, 0] } }), goal({ status: 'no-route' }), goal({ status: 'no-token' }), goal({ journey: { bar: { own: 0, now: 2 }, steps: [0, 0] } })]
    .map((g) => goalCards([g], ships)[0].tag);
  assert.deepEqual(tags, ['Goal · 1 upgrade to buy', 'Goal · chain ready', 'Goal · no route', 'Goal · needs a starting ship', 'Goal · 2 upgrades to buy']);
  const owned = ownedCards([{ key: 'id:2', shipId: 2, name: 'Beta', manufacturer: 'M', count: 1, pledgeIds: ['1'], insurance: 'Lifetime Insurance', lti: true }], [pledge('1', 'Standalone Ship - Beta')], ships);
  const items = fleetItems(owned, goalCards([goal({})], ships));
  assert.equal(items.length, 2);
  assert.equal(applyFilters(items, FLEET_GROUPS, emptySel(FLEET_GROUPS)).length, 2);
  assert.deepEqual(applyFilters(items, FLEET_GROUPS, toggleOption(emptySel(FLEET_GROUPS), 'show', 'goal')).map((c) => c.kind), ['owned']);
  assert.deepEqual(applyFilters(items, FLEET_GROUPS, toggleOption(emptySel(FLEET_GROUPS), 'insurance', 'lti')).map((c) => c.kind), ['owned']);
  assert.deepEqual(applyFilters(items, FLEET_GROUPS, toggleOption(emptySel(FLEET_GROUPS), 'stage', 'concept')).map((c) => c.kind), ['goal']);
  assert.deepEqual(fleetItems(owned, [], 'standalone beta').map((c) => c.name), ['Beta']);
  assert.deepEqual(fleetItems(owned, [], 'nothing'), []);
});

test('other pledges: only paints, equipment and the rest; filters and search', () => {
  const list = [pledge('1', 'Hull Paint', { category: 'paint', giftable: true }), pledge('2', 'Ship', { category: 'ship' }), pledge('3', 'Rifle', { category: 'equipment', reclaimable: true }), pledge('4', 'CCU', { category: 'ccu' }), pledge('5', 'Misc', { category: 'other' })];
  const o = otherPledges(list);
  assert.deepEqual(o.map((p) => p.pledgeId), ['1', '3', '5']);
  assert.deepEqual(applyFilters(o, OTHER_GROUPS, toggleOption(emptySel(OTHER_GROUPS), 'kind', 'paint')).map((p) => p.pledgeId), ['1']);
  assert.deepEqual(applyFilters(o, OTHER_GROUPS, toggleOption(emptySel(OTHER_GROUPS), 'reclaim', 'reclaim')).map((p) => p.pledgeId), ['3']);
  assert.deepEqual(searchPledges(o, 'rifle').map((p) => p.pledgeId), ['3']);
});

test('Saving has one meaning: the Standard price of the same upgrade today minus what you paid; no offer falls back to ship prices, marked as an estimate', () => {
  const standard = new Map([['1-2', 6000]]); // the ship prices say 5000, RSI sells it for 6000
  const [a, b] = ccuRows([copy('a', 1, 2, { paid: 4500 }), copy('b', 2, 3, { paid: 4500 })], ships, standard);
  assert.deepEqual([a.value, a.estimate, a.saving, a.pct], [6000, false, 1500, 25]);
  assert.deepEqual([b.value, b.estimate, b.saving], [10000, true, 5500], 'no Standard offer for 2-3: the ship price difference, an estimate');
  assert.equal(ccuRows([copy('c', 1, 99)], ships, standard)[0].estimate, false, 'unknown stays unknown, not an estimate');
});

test('a card with several pledges only says what holds for the pledge it describes', () => {
  const pledges = [pledge('1', 'Standalone Ship - Beta', { insurance: 'Lifetime Insurance', giftable: true }), pledge('2', 'Upgrade - Alpha to Beta', { upgraded: true, insurance: '120 Months Insurance' })];
  const fleet = [{ key: 'id:2', shipId: 2, name: 'Beta', manufacturer: 'M', count: 2, pledgeIds: ['1', '2'], insurance: 'Lifetime Insurance', lti: true }];
  const [c] = ownedCards(fleet, pledges, ships, new Set(['1']));
  assert.equal(c.line, '2 pledges', 'two different origins: no single origin line');
  assert.equal(c.insurance, 'LTI on 1 of 2');
  assert.deepEqual([c.startingText, c.giftableText], ['Starting ship on 1 of 2', 'Giftable on 1 of 2']);
  assert.equal(c.insuranceKind, 'lti', 'the filter still finds it');
  const same = ownedCards([{ ...fleet[0], pledgeIds: ['1', '1'] }], pledges, ships, new Set(['1']))[0];
  assert.deepEqual([same.line, same.insurance, same.startingText], ['Standalone ship', 'LTI', 'Starting ship']);
});

test('the Ships result line speaks one unit', () => {
  const o = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'owned', key: `o${i}` }));
  const g = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'goal', key: `g${i}` }));
  const all = [...o(10), ...g(10)];
  assert.equal(fleetCountText(all, all, 15), 'Showing 10 owned ships (15 pledges) · 10 goal ships');
  assert.equal(fleetCountText(all, all, 10), 'Showing 10 owned ships · 10 goal ships');
  assert.equal(fleetCountText([...o(1), ...g(1)], [...o(1), ...g(1)], 1), 'Showing 1 owned ship · 1 goal ship');
  assert.equal(fleetCountText(o(3), all, 15), 'Showing 3 of 20 · 3 owned, 0 goal');
  assert.equal(fleetCountText([], [], 0), '0 ships');
});
