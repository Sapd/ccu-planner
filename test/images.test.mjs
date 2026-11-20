import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOgImage, shipPageUrl } from '../src/logic/images.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/raw-small.json', import.meta.url), 'utf8'));
const meta = (content) => `<html><head><meta property="og:title" content="x" /><meta property="og:image" content="${content}" /></head></html>`;

test('parseOgImage returns the og:image URL on the RSI host', () => {
  assert.equal(parseOgImage(meta('https://robertsspaceindustries.com/i/abc/source.jpg')), 'https://robertsspaceindustries.com/i/abc/source.jpg');
  assert.equal(parseOgImage(`<meta content="https://robertsspaceindustries.com/i/q/s.jpg" property='og:image'>`), 'https://robertsspaceindustries.com/i/q/s.jpg');
  assert.equal(parseOgImage(meta('https://robertsspaceindustries.com/i/a/s.jpg?x=1&amp;y=2')), 'https://robertsspaceindustries.com/i/a/s.jpg?x=1&y=2');
});

test('parseOgImage keeps only /i/ and /media/ image paths', () => {
  assert.equal(parseOgImage(meta('https://robertsspaceindustries.com/media/abc/x.jpg')), 'https://robertsspaceindustries.com/media/abc/x.jpg');
  assert.equal(parseOgImage(meta('https://robertsspaceindustries.com/en/account/settings')), null);
  assert.equal(parseOgImage(meta('https://robertsspaceindustries.com/api/x.jpg')), null);
});

test('parseOgImage is null without the tag, for other hosts and for junk', () => {
  assert.equal(parseOgImage('<html><meta property="og:title" content="x"></html>'), null);
  assert.equal(parseOgImage(meta('https://evil.test/x.jpg')), null);
  assert.equal(parseOgImage(meta('https://robertsspaceindustries.com.evil.test/x.jpg')), null);
  assert.equal(parseOgImage(meta('http://robertsspaceindustries.com/x.jpg')), null);
  assert.equal(parseOgImage(null), null);
  assert.equal(parseOgImage(''), null);
});

test('shipPageUrl adds /en once', () => {
  assert.equal(shipPageUrl('/pledge/ships/rsi-aurora/Aurora-Mk-I-ES'), 'https://robertsspaceindustries.com/en/pledge/ships/rsi-aurora/Aurora-Mk-I-ES');
  assert.equal(shipPageUrl('/en/pledge/ships/a/B'), 'https://robertsspaceindustries.com/en/pledge/ships/a/B');
  assert.equal(shipPageUrl('/english/x'), null, 'only ship pages');
  assert.equal(shipPageUrl('/pledge/extras/x'), null);
  assert.equal(shipPageUrl('/en/account/pledges'), null);
  assert.equal(shipPageUrl(''), null);
  assert.equal(shipPageUrl('https://evil.test/x'), null);
  assert.equal(shipPageUrl(undefined), null);
});

test('buildPlannerData sets ship.image { s, l } only when both thumbs are recorded; imageUrl keeps the remote url', () => {
  const url = 'https://robertsspaceindustries.com/i/abc/source.jpg';
  const t = (id) => ({ s: `${id}-s.webp`, l: `${id}-l.webp`, sourceUrl: url, bytes: 1 });
  const data = buildPlannerData({ ...raw, images: { images: { 1: { url, thumbs: t(1) }, 2: { url, thumbs: { s: '2-s.webp' } }, 3: { url } } } }, { items: {} });
  assert.deepEqual(data.ships.get(1).image, { s: '1-s.webp', l: '1-l.webp' });
  assert.equal(data.ships.get(1).imageUrl, url);
  assert.equal(data.ships.get(2).image, null);
  assert.equal(data.ships.get(3).image, null);
  assert.equal(data.ships.get(3).imageUrl, url);
  for (const [id, s] of data.ships) if (id !== 1) assert.equal(s.image, null);
});

test('thumb names must belong to the ship and match the file pattern', () => {
  const bad = [{ s: '../x-s.webp', l: '1-l.webp' }, { s: '1-s.png', l: '1-l.webp' }, { s: '2-s.webp', l: '2-l.webp' }, { s: '1-l.webp', l: '1-s.webp' }, { s: 5, l: 6 }];
  for (const thumbs of bad) {
    const data = buildPlannerData({ ...raw, images: { images: { 1: { url: null, thumbs } } } }, { items: {} });
    assert.equal(data.ships.get(1).image, null);
  }
});

test('without the file every ship has image null', () => {
  const data = buildPlannerData(raw, { items: {} });
  assert.ok(data.ships.size > 0);
  for (const s of data.ships.values()) assert.equal(s.image, null);
});

test('buildPlannerData ignores stored urls outside the RSI image host', () => {
  const good = 'https://robertsspaceindustries.com/i/a/s.jpg';
  const data = buildPlannerData({ ...raw, images: { images: { 1: { url: 'https://evil.test/x.jpg' }, 2: { url: 'javascript:alert(1)' }, 3: { url: good }, 4: { url: 42 } } } }, { items: {} });
  assert.equal(data.ships.get(1).imageUrl, null);
  assert.equal(data.ships.get(2).imageUrl, null);
  assert.equal(data.ships.get(3).imageUrl, good);
});
