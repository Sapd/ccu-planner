import test from 'node:test';
import assert from 'node:assert/strict';
import { plainUpdateError, checkLine, notesText, CHECK_EVERY_MS, RELEASES_URL } from '../../app/src/lib/view/updater.mjs';

test('update errors are explained in plain words', () => {
  assert.match(plainUpdateError(new Error('error sending request for url')), /Could not reach the update server/);
  assert.match(plainUpdateError('Minisign signature verification failed'), /could not be verified/);
  assert.match(plainUpdateError(undefined), /Could not reach/);
});

test('the Help line follows the check state', () => {
  assert.equal(checkLine('uptodate', '0.1.0', null, ''), "You're up to date (0.1.0).");
  assert.equal(checkLine('idle', '0.1.0', null, ''), 'You have 0.1.0.');
  assert.equal(checkLine('error', '0.1.0', null, 'boom'), 'boom');
  assert.match(checkLine('ready', '0.1.0', '0.2.0', ''), /0\.2\.0 is ready/);
});

test('notes are trimmed and capped; checks run every six hours', () => {
  assert.equal(notesText('  hi \n'), 'hi');
  assert.equal(notesText(null), '');
  assert.equal(notesText('x'.repeat(5000)).length, 2000);
  assert.equal(CHECK_EVERY_MS, 21_600_000);
});

test('an available portable update announces its version and points to the project releases', () => {
  assert.equal(checkLine('available', '0.1.0', '0.2.0', ''), 'Version 0.2.0 is available');
  assert.equal(RELEASES_URL, 'https://github.com/Sapd/ccu-planner/releases/latest');
});
