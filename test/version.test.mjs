import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionFiles, bumpVersion, checkVersion, currentVersion, feedFloorAt } from '../scripts/version.mjs';

const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-version-'));
  for (const [k, src] of Object.entries(versionFiles(REAL))) {
    const dst = versionFiles(dir)[k];
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return dir;
}

test('the repository files agree and match their own version', () => {
  const v = checkVersion(REAL);
  const floor = Date.parse(JSON.parse(fs.readFileSync(versionFiles(REAL).feedFloor, 'utf8')).minGeneratedAt);
  assert.equal(checkVersion(REAL, `v${v}`, floor + 3600e3), v); // the floor's age is the release's business, not a clock this test depends on
  assert.throws(() => checkVersion(REAL, 'v99.0.0'), /does not match/);
});

test('bump changes every file consistently and the check passes afterwards', () => {
  const dir = copyRoot();
  try {
    bumpVersion(dir, '7.8.9');
    assert.equal(currentVersion(dir), '7.8.9');
    assert.equal(checkVersion(dir, 'v7.8.9'), '7.8.9');
    const f = versionFiles(dir);
    assert.equal(JSON.parse(fs.readFileSync(f.tauriConf, 'utf8')).version, '7.8.9');
    assert.equal(JSON.parse(fs.readFileSync(f.appLock, 'utf8')).packages[''].version, '7.8.9');
    assert.match(fs.readFileSync(f.cargoLock, 'utf8'), /name = "ccu-planner-desktop"\nversion = "7\.8\.9"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('bump rejects a bad version and the check catches a file that was left behind', () => {
  const dir = copyRoot();
  try {
    assert.throws(() => bumpVersion(dir, 'v1.2'), /Version must look like/);
    const f = versionFiles(dir);
    fs.writeFileSync(f.appPackage, fs.readFileSync(f.appPackage, 'utf8').replace(/"version": "[^"]+"/, '"version": "0.0.1"'));
    assert.throws(() => checkVersion(dir), /disagree/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a release moves the feed replay floor to one day before the bump, and a tag check refuses a stale or future one', () => {
  const dir = copyRoot();
  try {
    const now = Date.parse('2026-12-01T12:00:30.700Z');
    assert.equal(feedFloorAt(now), '2026-11-30T12:00:30Z');
    bumpVersion(dir, '7.8.9', now);
    const f = versionFiles(dir);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.feedFloor, 'utf8')), { minGeneratedAt: '2026-11-30T12:00:30Z' });
    assert.equal(checkVersion(dir, 'v7.8.9', now + 3600e3), '7.8.9');
    assert.throws(() => checkVersion(dir, 'v7.8.9', now + 46 * 24 * 3600e3), /feed-floor/);
    assert.throws(() => checkVersion(dir, 'v7.8.9', now - 2 * 24 * 3600e3), /feed-floor/);
    assert.equal(checkVersion(dir, undefined, now + 100 * 24 * 3600e3), '7.8.9', 'a check without a tag does not look at the floor');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
