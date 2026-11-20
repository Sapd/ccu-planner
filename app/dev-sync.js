// Dev-only child process host. Fixed argv and a cooperative stdin control channel.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// The pictures and the store catalog have their own scripts; every other kind is a section of scripts/sync.mjs.
const SCRIPT = { images: 'scripts/sync-images.mjs', 'store-catalog': 'scripts/sync-catalog.mjs' };
export function createSyncRunner(dir, spawnChild = spawn, platform = process.platform) {
  let child = null, loginPending = null;
  let status = { running: false, progress: null, error: null, confirmation: null };
  const control = (message) => { if (child?.stdin?.writable !== false) child?.stdin?.write(JSON.stringify(message) + '\n'); };
  return {
    status: () => ({ ...status }),
    cancel: () => { if (platform === 'win32') control({ type: 'cancel' }); else child?.kill('SIGINT'); },
    confirm(id, accept) {
      if (!child || status.confirmation?.id !== id) throw new Error('No matching confirmation');
      control({ type: 'confirm', id, accept: accept === true }); status.confirmation = null;
    },
    start(kind, { force = false } = {}) {
      if (loginPending) throw new Error('RSI login is pending');
      if (child) throw new Error('A sync is already running');
      if (!['hangar', 'buyback', 'upgrades', 'images', 'store-catalog'].includes(kind)) throw new Error('Unknown sync');
      const job = status = { running: true, progress: null, error: null, confirmation: null };
      const proc = spawnChild(process.execPath, [SCRIPT[kind] ?? 'scripts/sync.mjs', ...(kind in SCRIPT ? [] : [kind]), ...(force === true && !(kind in SCRIPT) ? ['--force'] : [])], { cwd: root, env: { ...process.env, CCU_DATA: dir, CCU_SYNC_INTERACTIVE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
      child = proc;
      proc.stdin?.on('error', () => {}); // Child may finish just before a control message.
      let tail = '', error = '';
      proc.stdout.on('data', (bytes) => {
        tail += bytes;
        const lines = tail.split('\n'); tail = lines.pop();
        for (const line of lines) {
          try {
            if (line.startsWith('progress ')) job.progress = JSON.parse(line.slice(9));
            if (line.startsWith('confirmation ')) job.confirmation = JSON.parse(line.slice(13));
          } catch { /* not a control event */ }
        }
      });
      proc.stderr.on('data', (bytes) => { error = (error + bytes).slice(-2000); });
      proc.on('error', (e) => { job.error = e.message; job.running = false; if (child === proc) child = null; });
      proc.on('close', (code) => {
        job.error ??= code === 0 ? null : error.trim() || (code === 130 ? 'Sync cancelled; progress saved' : 'Sync failed');
        job.running = false; job.confirmation = null; if (child === proc) child = null;
      });
      return job;
    },
    session(action) {
      if (!['status', 'login', 'logout'].includes(action)) throw new Error('Unknown session action');
      if (child) throw new Error('Wait for the sync to finish');
      if (loginPending) throw new Error('RSI login is pending');
      const login = action === 'login' ? {} : null;
      if (login) loginPending = login;
      return new Promise((resolve, reject) => {
        let proc;
        const finish = () => { if (login && loginPending === login) loginPending = null; };
        try { proc = spawnChild(process.execPath, ['scripts/dev-session.mjs', action], { cwd: root, env: { ...process.env, CCU_DATA: dir }, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { finish(); reject(e); return; }
        let out = '', error = '';
        proc.stdout.on('data', (b) => { out = (out + b).slice(-2000); });
        proc.stderr.on('data', (b) => { error = (error + b).slice(-2000); });
        proc.on('error', (e) => { finish(); reject(e); });
        proc.on('close', (code) => { finish(); code === 0 ? resolve(out.trim()) : reject(new Error(error.trim() || 'Session action failed')); });
      });
    },
  };
}
