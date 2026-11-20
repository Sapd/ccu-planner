// A short exclusive lock around "check the revision, write, rename" of a revisioned document, across processes (the CLI, the
// MCP server, the dev server, the desktop app). <data>/.write.lock holds { pid, startedAt }, created with the exclusive flag.
// Stale after 30 s or when its process is gone; a waiter retries for about 2 s, then fails with a clear message. The desktop
// app's Rust store takes the same file with the same rules (app/src-tauri/src/lock.rs).
import fs from 'node:fs';
import path from 'node:path';
import { readLock, takeOver, pidAlive } from './lock.mjs';

export const WRITE_LOCK_NAME = '.write.lock';
export const WRITE_STALE_MS = 30_000;
export const WRITE_WAIT_MS = 2_000;
export const DATA_BUSY = 'Data folder busy: another planner process is saving. Try again in a moment.';

export class DataBusyError extends Error {
  constructor() { super(DATA_BUSY); this.busy = true; }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Runs fn() while holding <dir>/.write.lock. Throws DataBusyError when the lock cannot be had within waitMs.
 * `afterJudge` is a test hook between judging a lock stale and taking it over.
 */
export function withWriteLock(dir, fn, { now = Date.now, pid = process.pid, alive = pidAlive, staleMs = WRITE_STALE_MS, waitMs = WRITE_WAIT_MS, sleep = sleepSync, afterJudge = null } = {}) {
  const file = path.join(dir, WRITE_LOCK_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const mine = JSON.stringify({ pid, startedAt: new Date(now()).toISOString() });
  const deadline = Date.now() + waitMs;
  for (;;) {
    let created = false;
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      created = true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e; // only the creation's EEXIST means "held": retry
    }
    if (created) {
      try {
        return fn(); // outside the try above: an EEXIST thrown by the work is the work's error
      } finally {
        // Only remove our own lock.
        try { if (readLock(file)?.raw === mine) fs.unlinkSync(file); } catch { /* already gone */ }
      }
    }
    const lock = readLock(file);
    if (lock !== null) {
      let stale;
      if (lock.info) stale = !alive(lock.info.pid) || now() - Date.parse(lock.info.startedAt) >= staleMs;
      else {
        const st = fs.statSync(file, { throwIfNoEntry: false });
        stale = !!st && now() - st.mtimeMs > staleMs;
      }
      if (stale) {
        afterJudge?.();
        if (takeOver(file, lock.raw)) continue;
      }
    } else continue; // released between the two calls
    if (Date.now() >= deadline) throw new DataBusyError();
    sleep(20);
  }
}
