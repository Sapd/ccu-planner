import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupWanted, parseSlackUsd } from '../src/logic/wantedView.mjs';

const item = (from, to, standard, below, needOff, extra = {}) => ({ from, to, standard, below, needOff, createsRoute: false, onBestRoute: false, ...extra });

test('ties into the same target form one group; a need carries its share', () => {
  const g = groupWanted({ wanted: [
    item(1, 9, 5000, 5000, 0),
    item(2, 9, 6000, 6000, 0),
    item(3, 8, 7000, 6000, 1000),
  ] });
  assert.equal(g.ties.length, 1);
  assert.equal(g.ties[0].to, 9);
  assert.equal(g.ties[0].items.length, 2);
  assert.equal(g.needs.length, 1);
  assert.equal(g.needs[0].sharePct, 14);
  assert.equal(g.createsRoute.length, 0);
});

test('createsRoute items appear only in createsRoute', () => {
  const g = groupWanted({ wanted: [item(1, 9, 5000, 5000, 0, { createsRoute: true }), item(2, 9, 6000, 6000, 0, { createsRoute: true })] });
  assert.equal(g.createsRoute.length, 2);
  assert.deepEqual([g.ties.length, g.needs.length], [0, 0]);
});

test('an empty result groups to nothing', () => {
  assert.deepEqual(groupWanted({ wanted: [] }), { createsRoute: [], ties: [], needs: [] });
});

test('needs groups come out sorted by share; input order breaks ties', () => {
  const g = groupWanted({ wanted: [
    item(1, 7, 10000, 5000, 3000), item(2, 8, 10000, 5000, 1000), item(3, 6, 10000, 5000, 3000),
  ] });
  assert.deepEqual(g.needs.map((x) => x.to), [8, 7, 6]);
  assert.deepEqual(groupWanted({ wanted: [item(1, 7, 10000, 5000, 3000), item(2, 8, 10000, 5000, 1000)] }, { sortNeeds: false }).needs.map((x) => x.to), [7, 8]);
});

test('two needs into one target land in one group', () => {
  const g = groupWanted({ wanted: [item(1, 9, 7000, 6000, 1000), item(2, 9, 8000, 6000, 2000)] });
  assert.equal(g.needs.length, 1);
  assert.equal(g.needs[0].items.length, 2);
});

test('wanted undefined gives empty groups', () => {
  assert.deepEqual(groupWanted({}), { createsRoute: [], ties: [], needs: [] });
});

test('parseSlackUsd accepts only non-negative decimals', () => {
  assert.equal(parseSlackUsd(''), null);
  assert.equal(parseSlackUsd('  '), null);
  assert.equal(parseSlackUsd('-1'), null);
  assert.equal(parseSlackUsd('abc'), null);
  assert.equal(parseSlackUsd(null), null);
  assert.equal(parseSlackUsd('10'), 1000);
  assert.equal(parseSlackUsd('2.5'), 250);
  assert.equal(parseSlackUsd('0'), 0);
});
