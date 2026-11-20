import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, usd } from '../src/logic/format.mjs';

test('a negative amount is "−$5" with a real minus sign before the symbol, never "$-5"', () => {
  assert.equal(usd(-500), '−$5');
  assert.equal(usd(-1250), '−$12.50');
  assert.equal(usd(0), '$0');
  assert.equal(usd(4250), '$42.50');
  assert.equal(usd(null), '?');
  assert.equal(money(-500, { currencyCode: 'EUR', currencySymbol: '€', exponent: 2 }), '−€5');
});
