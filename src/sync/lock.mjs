// One sync at a time per data folder, across processes: the CLI, the dev server's child sync and the MCP server take
// <data>/sync.lock (pid and start time, created with the exclusive flag). A lock whose process is gone, or that is older than
// two hours with a dead process is stale and taken over (a live pid over two hours is reported, not taken). The desktop app
// takes the very same file from Rust (app/src-tauri/src/lock.rs, same JSON, same stale rules) when its in-webview sync begins.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LOCK_NAME = 'sync.lock';
export const STALE_MS = 2 * 60 * 60 * 1000;

export class SyncBusyError extends Error {
  constructor(info, message = null) {
    super(message ?? `Another sync is running (started ${info?.startedAt ?? 'at an unknown time'}${info?.pid ? `, pid ${info.pid}` : ''}).`);
    this.busy = true;
    this.info = info;
  }
}

export const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/** The lock's text and what it says: { raw, info } with info null when empty or unreadable; null when the file is gone. */
export function readLock(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const info = JSON.parse(raw);
    return { raw, info: Number.isInteger(info?.pid) && Number.isFinite(Date.parse(info.startedAt)) ? info : null };
  } catch {
    return { raw, info: null };
  }
}

/**
 * Takes a stale lock away without ever leaving two holders: rename it to a unique name (so only one taker gets it), check it is
 * still what was judged stale, delete it. If it changed in between (someone else took it over and created a fresh lock), put it back
 * if the name is free and give up.
 * @returns {boolean} true when the stale lock is gone and the caller may try to create its own
 */
export function takeOver(file, judgedRaw) {
  const mine = `${file}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(file, mine); } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
  let now = null;
  try { now = fs.readFileSync(mine, 'utf8'); } catch { /* unreadable: treated as changed */ }
  if (now === judgedRaw) {
    fs.unlinkSync(mine);
    return true;
  }
  try { fs.linkSync(mine, file); } catch { /* a newer lock already exists: that one wins */ }
  try { fs.unlinkSync(mine); } catch { /* gone */ }
  return false;
}

/**
 * @returns {() => void} release. Throws SyncBusyError while another live sync holds the lock (or one has run for over two hours:
 * then it is not taken over, the message says how to remove it).
 * `afterJudge` is a test hook between judging a lock stale and taking it over.
 */
export function acquireSyncLock(dir, { now = Date.now, pid = process.pid, alive = pidAlive, staleMs = STALE_MS, afterJudge = null } = {}) {
  const file = path.join(dir, LOCK_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const mine = JSON.stringify({ pid, startedAt: new Date(now()).toISOString() });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      return () => {
        // Only remove our own lock.
        try { if (readLock(file)?.info?.pid === pid) fs.unlinkSync(file); } catch { /* already gone */ }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const lock = readLock(file);
    if (lock === null) continue; // released between the two calls
    let stale;
    if (lock.info) {
      if (!alive(lock.info.pid)) stale = true;
      else if (now() - Date.parse(lock.info.startedAt) >= staleMs) {
        throw new SyncBusyError(lock.info, `A sync has been running for over 2 h (started ${lock.info.startedAt}, pid ${lock.info.pid}); if it is stuck, delete ${file}.`);
      } else throw new SyncBusyError(lock.info);
    } else {
      // Empty or corrupt: a writer may be in the middle of creating it, so only a lock older than a minute is stale.
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (!st) continue;
      if (!(now() - st.mtimeMs > 60_000)) throw new SyncBusyError(null);
      stale = true;
    }
    if (stale) {
      afterJudge?.();
      if (!takeOver(file, lock.raw)) throw new SyncBusyError(readLock(file)?.info ?? null);
    }
  }
  throw new SyncBusyError(readLock(file)?.info ?? null);
}
