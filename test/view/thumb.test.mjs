import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials, thumbSize, thumbFile } from '../../app/src/lib/view/thumb.mjs';

test('initials: up to three words, two letters for one word, ? for none', () => {
  assert.equal(initials('Roberts Space Industries'), 'RSI');
  assert.equal(initials('Aegis Dynamics'), 'AD');
  assert.equal(initials('Origin Jumpworks GmbH Extra'), 'OJG');
  assert.equal(initials('Drake'), 'DR');
  assert.equal(initials("Xi'an"), 'XI');
  assert.equal(initials('  '), '?');
  assert.equal(initials(null), '?');
});

test('thumbSize keeps known sizes and falls back to xs', () => {
  for (const s of ['xs', 's', 'm', 'card', 'hero']) assert.equal(thumbSize(s), s);
  assert.equal(thumbSize('huge'), 'xs');
  assert.equal(thumbSize(undefined), 'xs');
});

test('thumbFile: the small file for xs/s/m, the large one for hero, null without a picture', () => {
  const image = { s: '1-s.webp', l: '1-l.webp' };
  for (const size of ['xs', 's', 'm']) assert.equal(thumbFile(image, size), '1-s.webp');
  assert.equal(thumbFile(image, 'hero'), '1-l.webp');
  assert.equal(thumbFile(null, 'hero'), null);
  assert.equal(thumbFile(undefined, 's'), null);
});

test('thumbFile: card uses the large picture, falling back to the small one', () => {
  assert.equal(thumbFile({ s: 'a-s.webp', l: 'a-l.webp' }, 'card'), 'a-l.webp');
  assert.equal(thumbFile({ s: 'a-s.webp' }, 'card'), 'a-s.webp');
  assert.equal(thumbFile(null, 'card'), null);
});

test('shipPicture: the picture sync wins, the feed fills in, a ship without either has none', async () => {
  const { shipPicture } = await import('../../app/src/lib/view/thumb.mjs');
  const feed = { 7: 'feed/ships/7.webp' };
  assert.deepEqual(shipPicture({ id: 7, image: { s: '7-s.webp', l: '7-l.webp' } }, feed), { s: '7-s.webp', l: '7-l.webp' });
  assert.deepEqual(shipPicture({ id: 7, image: null }, feed), { s: 'feed/ships/7.webp', l: 'feed/ships/7.webp' });
  assert.equal(shipPicture({ id: 8, image: null }, feed), null);
  assert.equal(shipPicture({ name: 'no id', image: null }, feed), null);
  assert.equal(shipPicture(null, feed), null);
  assert.equal(shipPicture({ id: 7, image: null }), null);
  assert.equal(thumbFile(shipPicture({ id: 7, image: null }, feed), 'hero'), 'feed/ships/7.webp');
});
