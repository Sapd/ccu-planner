import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, ADVANCED, ADVANCED_HINT, PAGE_INFO, stampLabel, stampIsStale, heroSource } from '../../app/src/lib/view/nav.mjs';

test('SECTIONS and ADVANCED are the agreed lists', () => {
  assert.deepEqual(SECTIONS, ['today', 'goals', 'hangar', 'store']);
  assert.deepEqual(ADVANCED, [['graphs', 'Upgrade map'], ['explorer', 'Compare routes'], ['prices', 'Price assumptions']]);
});

test('heroSource prefers the large picture, then the small one, then initials', () => {
  assert.deepEqual(heroSource({ image: { s: '1-s.webp', l: '1-l.webp' }, manufacturer: 'Aegis Dynamics' }), { kind: 'image', file: '1-l.webp', files: ['1-l.webp'] });
  assert.deepEqual(heroSource({ image: { s: '1-s.webp' }, manufacturer: 'Aegis Dynamics' }), { kind: 'image', file: '1-s.webp', files: ['1-s.webp'] });
  assert.deepEqual(heroSource({ image: null, manufacturer: 'Aegis Dynamics' }), { kind: 'initials', text: 'AD' });
  assert.deepEqual(heroSource(null), { kind: 'initials', text: '?' });
});

test('heroSource uses the feed picture before any picture sync, and after a synced one fails', () => {
  const feed = { 7: 'feed/ships/7.webp' };
  assert.deepEqual(heroSource({ id: 7, image: null, manufacturer: 'Anvil Aerospace' }, feed), { kind: 'image', file: 'feed/ships/7.webp', files: ['feed/ships/7.webp'] });
  assert.deepEqual(heroSource({ id: 7, image: { s: '7-s.webp', l: '7-l.webp' } }, feed).files, ['7-l.webp', 'feed/ships/7.webp']);
  // Sample data's made-up ships do not get the real ships' feed pictures.
  assert.deepEqual(heroSource({ id: 7, image: null, manufacturer: 'Anvil Aerospace' }, feed, { sample: true }), { kind: 'initials', text: 'AA' });
});

test('every section and Advanced page has a title and one plain purpose sentence; every Advanced item has a hint', () => {
  for (const key of [...SECTIONS, ...ADVANCED.map(([k]) => k)]) {
    const p = PAGE_INFO[key];
    assert.ok(p?.title && p.purpose.endsWith('.') && p.purpose.length < 90, key);
    assert.doesNotMatch(p.purpose, /\b[a-z]+-id\b|undefined/, key);
  }
  for (const [key] of ADVANCED) assert.ok(ADVANCED_HINT[key]?.length > 10, key);
});

test('stampLabel: never, today with a time, or the date', () => {
  const now = new Date(2026, 10, 19, 15, 0);
  assert.equal(stampLabel(null, now), 'never');
  assert.equal(stampLabel(new Date(2026, 10, 19, 9, 5).toISOString(), now), 'today, 09:05');
  assert.equal(stampLabel(new Date(2026, 10, 1, 9, 5).toISOString(), now), '1 Nov, 09:05');
});

test('stampIsStale: grey for a sync from yesterday, orange when missing or over two days old', () => {
  const now = new Date(2026, 10, 20, 12, 0);
  assert.equal(stampIsStale(null, now), true);
  assert.equal(stampIsStale(new Date(2026, 10, 19, 17, 28).toISOString(), now), false);
  assert.equal(stampIsStale(new Date(2026, 10, 18, 9, 0).toISOString(), now), true);
});
