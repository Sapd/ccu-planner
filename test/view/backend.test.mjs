import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backend } from '../../app/src/lib/backend.js';

test('openExternal refuses a non-RSI URL before doing anything', async () => {
  for (const url of ['https://evil.example/', 'https://robertsspaceindustries.com.evil.com/', 'javascript:alert(1)', 'file:///etc/passwd']) {
    await assert.rejects(() => backend.openExternal(url), /non-RSI URL/, url);
  }
});
