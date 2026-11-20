import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { acquireSyncLock, SyncBusyError, LOCK_NAME, STALE_MS } from '../src/sync/lock.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-lock-'));
const lockFile = (dir) => path.join(dir, LOCK_NAME);

test('the lock is exclusive, says since when, and is released', () => {
  const dir = tmp();
  const release = acquireSyncLock(dir, { now: () => Date.parse('2026-11-19T10:00:00Z') });
  const doc = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8'));
  assert.equal(doc.pid, process.pid);
  assert.equal(doc.startedAt, '2026-11-19T10:00:00.000Z');
  assert.throws(() => acquireSyncLock(dir, { now: () => Date.parse('2026-11-19T10:05:00Z') }), (e) => e instanceof SyncBusyError && /^Another sync is running \(started 2026-11-19T10:00:00.000Z/.test(e.message));
  release();
  assert.ok(!fs.existsSync(lockFile(dir)));
  acquireSyncLock(dir)();
});

test('a lock of a dead process is taken over; a live one and a fresh corrupt one are respected', () => {
  const dir = tmp();
  const at = Date.parse('2026-11-19T10:00:00Z');
  fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 999999, startedAt: new Date(at - 1000).toISOString() }));
  acquireSyncLock(dir, { now: () => at, alive: () => false })();
  fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 1, startedAt: new Date(at - 1000).toISOString() }));
  assert.throws(() => acquireSyncLock(dir, { now: () => at, alive: () => true }), SyncBusyError);
  fs.writeFileSync(lockFile(dir), 'garbage');
  assert.throws(() => acquireSyncLock(dir), SyncBusyError);
});

test('release removes only our own lock', () => {
  const dir = tmp();
  const release = acquireSyncLock(dir, { pid: 111 });
  fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 222, startedAt: new Date().toISOString() }));
  release();
  assert.equal(JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')).pid, 222);
});

test('the CLI sync honours the lock and does not touch RSI', () => {
  const dir = tmp();
  const release = acquireSyncLock(dir);
  const r = spawnSync(process.execPath, ['scripts/sync.mjs', 'hangar'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, CCU_DATA: dir }, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Another sync is running \(started /);
  release();
});

test('two takers of one stale lock never both hold it', () => {
  const dir = tmp();
  const at = Date.parse('2026-11-19T10:00:00Z');
  fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 999, startedAt: new Date(at - 5000).toISOString() }));
  const dead = (pid) => pid !== 111 && pid !== 222;
  let first;
  // taker 222 has judged the old lock stale and is about to take it over when taker 111 does the whole takeover and holds a fresh lock
  assert.throws(() => acquireSyncLock(dir, { now: () => at, pid: 222, alive: (p) => !dead(p), afterJudge: () => { first = acquireSyncLock(dir, { now: () => at, pid: 111, alive: (p) => !dead(p) }); } }), SyncBusyError);
  assert.equal(JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')).pid, 111, 'the first taker still holds the lock');
  assert.deepEqual(fs.readdirSync(dir), [LOCK_NAME], 'no stale file is left behind');
  first();
});

test('a live holder over two hours is reported with the path, not taken over', () => {
  const dir = tmp();
  const at = Date.parse('2026-11-19T10:00:00Z');
  fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: 1, startedAt: new Date(at - STALE_MS - 1).toISOString() }));
  assert.throws(() => acquireSyncLock(dir, { now: () => at, alive: () => true }), (e) => e instanceof SyncBusyError && /over 2 h.*if it is stuck, delete .*sync\.lock/.test(e.message));
  assert.ok(fs.existsSync(lockFile(dir)));
});

test('an empty or corrupt lock is stale after a minute, not before; a vanished file is fine', () => {
  const dir = tmp();
  fs.writeFileSync(lockFile(dir), '');
  const mtime = fs.statSync(lockFile(dir)).mtimeMs;
  assert.throws(() => acquireSyncLock(dir, { now: () => mtime + 1000 }), SyncBusyError);
  acquireSyncLock(dir, { now: () => mtime + 61_000 })();
  fs.writeFileSync(lockFile(dir), '{"pid":"x"}');
  const m2 = fs.statSync(lockFile(dir)).mtimeMs;
  acquireSyncLock(dir, { now: () => m2 + 61_000 })();
  assert.ok(!fs.existsSync(lockFile(dir)));
});
