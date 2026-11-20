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
