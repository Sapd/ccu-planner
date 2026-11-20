import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backend } from '../../app/src/lib/backend.js';
import { RELEASES_URL } from '../../app/src/lib/view/updater.mjs';

test('openExternal refuses URLs outside the allowlist before doing anything', async () => {
  for (const url of [
    'https://evil.example/',
    'https://robertsspaceindustries.com.evil.com/',
    'https://github.com/Sapd/ccu-planner',
    'https://github.com/Sapd/ccu-planner/releases/latest?other=1',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    await assert.rejects(() => backend.openExternal(url), /Refusing to open this URL/, url);
  }
});

test('openExternal opens the exact release URL in the system browser', async (t) => {
  const open = t.mock.fn();
  globalThis.window = { __TAURI_INTERNALS__: { invoke: open } };
  t.after(() => { delete globalThis.window; });
  await backend.openExternal(RELEASES_URL);
  assert.equal(open.mock.callCount(), 1);
  assert.equal(open.mock.calls[0].arguments[0], 'plugin:opener|open_url');
  assert.equal(open.mock.calls[0].arguments[1].url, RELEASES_URL);
});
