import { test } from 'node:test';
import assert from 'node:assert/strict';

test('every chip state has a tooltip, and the filler and lock chips explain themselves', async () => {
  const { STATE_LABEL, STATE_HELP, chipHelp, FILLER_HELP, LOCK_HELP } = await import('../src/logic/describe.mjs');
  for (const state of Object.keys(STATE_LABEL)) assert.ok(STATE_HELP[state]?.startsWith(STATE_LABEL[state]), state);
  assert.equal(chipHelp('wait', { filler: true }), FILLER_HELP);
  assert.equal(chipHelp('now', { lock: true }), LOCK_HELP);
  assert.equal(chipHelp('wait'), STATE_HELP.wait);
  assert.equal(chipHelp('own', { lock: true }), STATE_HELP.own);
});
