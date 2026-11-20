import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINKS, upgradeToolUrl, hangarUrl, buybackUrl, isRsiUrl } from '../src/logic/links.mjs';

const B = 'https://robertsspaceindustries.com';

test('upgrade tool: bare URL while preselection is unverified', () => {
  assert.equal(LINKS.upgradePreselect, null);
  assert.equal(upgradeToolUrl({ from: 1, to: 2 }), `${B}/en/pledge/ship-upgrade-ccu`);
});

test('upgrade tool: carries from/to when a format is configured', () => {
  LINKS.upgradePreselect = { from: 'from', to: 'to' };
  try { assert.equal(upgradeToolUrl({ from: 1, to: 2 }), `${B}/en/pledge/ship-upgrade-ccu?from=1&to=2`); }
  finally { LINKS.upgradePreselect = null; }
});

test('hangar URL, with search only when a parameter is configured', () => {
  assert.equal(hangarUrl(), `${B}/en/account/pledges?product-type=upgrade`);
  assert.equal(hangarUrl({ search: 'Pulse' }), `${B}/en/account/pledges?product-type=upgrade`);
  LINKS.hangarSearch = 'search';
  try { assert.equal(hangarUrl({ search: 'Pulse' }), `${B}/en/account/pledges?product-type=upgrade&search=Pulse`); }
  finally { LINKS.hangarSearch = null; }
});

test('buy-back URL, list page without an id', () => {
  assert.equal(buybackUrl(61965779), `${B}/en/pledge/buyback/61965779`);
  assert.equal(buybackUrl(null), `${B}/en/account/buy-back-pledges`);
});

test('isRsiUrl accepts only https RSI URLs', () => {
  assert.equal(isRsiUrl(upgradeToolUrl({})), true);
  assert.equal(isRsiUrl('http://robertsspaceindustries.com/'), false);
  assert.equal(isRsiUrl('https://robertsspaceindustries.com.evil.test/'), false);
  assert.equal(isRsiUrl('javascript:alert(1)'), false);
  assert.equal(isRsiUrl(null), false);
  assert.equal(isRsiUrl('https://robertsspaceindustries.com/en/account/pledges'), true);
  for (const bad of [
    'https://robertsspaceindustries.com.evil.com/', 'https://user@evil.com/', 'https://robertsspaceindustries.com',
    'http://robertsspaceindustries.com/', 'https://robertsspaceindustries.com:8443/', 'data:text/html,<b>x</b>',
    'https://robertsspaceindustries.com@evil.com/', 'https://robertsspaceindustries.com\\@evil.com/',
  ]) assert.equal(isRsiUrl(bad), false, bad);
});
