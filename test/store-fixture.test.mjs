// The JS dev store and the Rust store (app/src-tauri/tests/store_fixture.rs) must behave the same.
// Both load the same folder, test/fixtures/store, and check the same expectations in
// test/fixtures/store-expected.json. Keep the two tests in step; a difference between the two stores
// is written down as a KNOWN DIFFERENCE test on each side, not silently fixed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevStore } from '../app/vite-dev-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'store');
const expected = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'store-expected.json'), 'utf8'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-store-fixture-'));
const copyFixture = () => { const dir = tmp(); fs.cpSync(FIXTURE, dir, { recursive: true }); return dir; };
const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

test('fixture: the documents load', () => {
  assert.deepEqual(createDevStore(copyFixture()).load(), expected.load);
});

test('fixture: a revisioned save with the right rev succeeds, a stale one is refused', () => {
  for (const { name, file, rev } of expected.saves) {
    const dir = copyFixture();
    const store = createDevStore(dir);
    const before = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.throws(() => store.save(name, { marker: 'stale' }, rev - 1), /^Error: conflict$/, `${name}: stale rev`);
    assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), before, `${name}: a refused save writes nothing`);
    assert.equal(store.save(name, { marker: 'fresh' }, rev), rev + 1, `${name}: right rev`);
    assert.deepEqual(readJson(dir, file), { marker: 'fresh', rev: rev + 1 });
    assert.throws(() => store.save(name, {}, rev), /^Error: conflict$/, `${name}: the old rev is stale now`);
  }
  assert.throws(() => createDevStore(copyFixture()).save('catalog', {}, 0), /unknown document name/);
});

test('fixture: import accepts and rejects the same file names', () => {
  const dest = tmp();
  const result = createDevStore(dest).importLegacy(FIXTURE);
  assert.deepEqual(result, { copied: expected.importCopied, skipped: [] });
  for (const rel of expected.importRejected) assert.ok(!fs.existsSync(path.join(dest, rel)), `${rel} must not be imported`);
  // A second import keeps the documents the user edits and the pictures; everything else is copied again.
  const again = createDevStore(dest).importLegacy(FIXTURE);
  assert.deepEqual(again.skipped, ['plans.json', 'price-overrides.json', 'sale-events.json', 'images/1-l.webp', 'images/1-s.webp']);
});

// KNOWN DIFFERENCE (see the matching Rust test): the JS store takes any name ending in ".json"
// as an upgrade file, so a file called exactly ".json" is read. Rust requires a file extension,
// and Rust treats ".json" as a name without one. Behaviour left as is.
test('known difference: an upgrade file named exactly ".json" is loaded by JS (not by Rust)', () => {
  const dir = copyFixture();
  fs.writeFileSync(path.join(dir, 'upgrades', '.json'), '{"id":"dot"}');
  assert.deepEqual(createDevStore(dir).load().upgrades.map((u) => u.id), ['dot', 'a', 'b']);
});

// KNOWN DIFFERENCE: load() in JS treats a symlinked catalog.json as "no data"; Rust follows the link.
// (Import refuses a symlinked catalog in both.) Behaviour left as is.
test('known difference: a symlinked catalog.json loads as no data in JS (Rust loads it)', { skip: process.platform === 'win32' }, () => {
  const dir = copyFixture();
  fs.renameSync(path.join(dir, 'catalog.json'), path.join(dir, 'real-catalog.json'));
  fs.symlinkSync(path.join(dir, 'real-catalog.json'), path.join(dir, 'catalog.json'));
  assert.equal(createDevStore(dir).load(), null);
});
