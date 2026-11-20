import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { withWriteLock, DataBusyError, WRITE_LOCK_NAME, WRITE_STALE_MS, DATA_BUSY } from '../src/sync/write-lock.mjs';
import { savePlans } from '../src/data.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-wl-'));
const lockFile = (dir) => path.join(dir, WRITE_LOCK_NAME);

test('the write lock is exclusive, says who holds it, and is released after the work (also after a throw)', () => {
  const dir = tmp();
  const seen = withWriteLock(dir, () => {
    const doc = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8'));
    assert.equal(doc.pid, process.pid);
    assert.ok(Number.isFinite(Date.parse(doc.startedAt)));
    assert.throws(() => withWriteLock(dir, () => assert.fail('must not run'), { waitMs: 60 }), (e) => e instanceof DataBusyError && e.message === DATA_BUSY);
    return 'done';
  });
  assert.equal(seen, 'done');
  assert.ok(!fs.existsSync(lockFile(dir)));
  assert.throws(() => withWriteLock(dir, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(lockFile(dir)));
});

test('a stale lock (dead process, or older than 30 s, or corrupt and old) is taken over; a fresh live one is waited for, then refused', () => {
  const dir = tmp();
  const at = Date.parse('2026-11-19T10:00:00Z');
  const put = (text) => fs.writeFileSync(lockFile(dir), text);
  put(JSON.stringify({ pid: 999999, startedAt: new Date(at - 1000).toISOString() }));
  assert.equal(withWriteLock(dir, () => 1, { now: () => at, alive: () => false }), 1);
  put(JSON.stringify({ pid: 1, startedAt: new Date(at - WRITE_STALE_MS - 1).toISOString() }));
  assert.equal(withWriteLock(dir, () => 2, { now: () => at, alive: () => true }), 2);
  put(JSON.stringify({ pid: 1, startedAt: new Date(at - 1000).toISOString() }));
  let slept = 0;
  assert.throws(() => withWriteLock(dir, () => 3, { now: () => at, alive: () => true, waitMs: 50, sleep: () => { slept++; } }), DataBusyError);
  assert.ok(slept > 0, 'it retried');
  assert.ok(fs.existsSync(lockFile(dir)), 'the live holder keeps its lock');
  put('garbage');
  const m = fs.statSync(lockFile(dir)).mtimeMs;
  assert.throws(() => withWriteLock(dir, () => 4, { now: () => m + 1000, waitMs: 30 }), DataBusyError);
  assert.equal(withWriteLock(dir, () => 5, { now: () => m + WRITE_STALE_MS + 1000 }), 5);
});

test('two processes saving with the same base revision: exactly one wins, the other gets the conflict', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'plans.json'), JSON.stringify({ rev: 3, chains: {} }));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const code = `import(${JSON.stringify(pathToFileURL(path.join(root, 'src/data.mjs')).href)}).then(({ savePlans }) => { const ok = savePlans({ rev: 3, chains: { w: Number(process.argv[2]) } }, process.argv[1]); console.log(JSON.stringify(ok)); })`;
  const run = (n) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['-e', code, dir, String(n)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (status) => (status === 0 ? resolve(JSON.parse(out)) : reject(new Error(`exit ${status}`))));
  });
  const results = await Promise.all([run(1), run(2), run(3), run(4)]);
  assert.equal(results.filter((r) => r === true).length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r === false).length, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'plans.json'), 'utf8')).rev, 4);
  assert.ok(!fs.existsSync(lockFile(dir)));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['plans.json']);
});

test('a save in a folder with a held lock fails with the clear busy error and writes nothing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'plans.json'), JSON.stringify({ rev: 0 }));
  fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  assert.throws(() => savePlans({ rev: 0, chains: {} }, dir), (e) => e instanceof DataBusyError);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'plans.json'), 'utf8')).rev, 0);
});
