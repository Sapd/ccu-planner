import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, searchText } from '../../src/logic/search.mjs';
import { NO_MATCHES, noMatchesText } from '../../src/logic/describe.mjs';

test('matchesQuery ignores case and punctuation', () => {
  assert.equal(matchesQuery('C8X Pisces Expedition', 'c8x'), true);
  assert.equal(matchesQuery('C8X Pisces Expedition', 'C-8X'), true);
  assert.equal(matchesQuery('C8X Pisces Expedition', 'pisces expedition'), true);
  assert.equal(matchesQuery('C8X Pisces Expedition', 'cutlass'), false);
});

test('matchesQuery needs every word, in any order', () => {
  const text = 'Cutlass Black · Drake Interplanetary';
  assert.equal(matchesQuery(text, 'drake cut'), true);
  assert.equal(matchesQuery(text, 'cut drake'), true);
  assert.equal(matchesQuery(text, 'drake zeus'), false);
});

test('an empty or blank query matches everything', () => {
  assert.equal(matchesQuery('anything', ''), true);
  assert.equal(matchesQuery('anything', '   '), true);
  assert.equal(matchesQuery('anything', undefined), true);
  assert.equal(matchesQuery('', ''), true);
  assert.equal(matchesQuery('', 'x'), false);
});

test('searchText joins the non-empty parts', () => {
  assert.equal(searchText('Cutlass', null, '', 'Drake', undefined), 'Cutlass Drake');
  assert.equal(searchText(), '');
  assert.equal(searchText(['A', 'B'], 'C'), 'A B C');
});

test('no-results copy', () => {
  assert.equal(noMatchesText('xyz'), 'Nothing matches "xyz".');
  assert.equal(noMatchesText('  xyz '), 'Nothing matches "xyz".');
  assert.equal(typeof NO_MATCHES, 'string');
});
