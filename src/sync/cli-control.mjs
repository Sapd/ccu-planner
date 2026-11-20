// Shared cooperative control channel for dev CLI children (including Windows).
// Credentials never travel on stdin/stdout. Only cancellation and confirmations do.
import { createInterface } from 'node:readline';
export function cliControl({ input = process.stdin, signals = process, exit = (code) => process.exit(code), interactive = process.env.CCU_SYNC_INTERACTIVE === '1', log = console.log } = {}) {
  let cancelled = false, pending = null, sequence = 0;
  const cancel = () => { cancelled = true; pending?.(false); pending = null; };
  const interrupt = () => { if (cancelled) exit(130); else cancel(); };
  signals.on('SIGINT', interrupt); signals.on('SIGTERM', cancel);
  const lines = interactive ? createInterface({ input }) : null;
  lines?.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === 'cancel') cancel();
      if (message.type === 'confirm' && message.id === sequence && pending) {
        const resolve = pending; pending = null; resolve(message.accept === true);
      }
    } catch { /* ignore malformed control messages */ }
  });
  lines?.on('close', cancel);
  return {
    cancelled: () => cancelled,
    confirmOverwrite: interactive ? (detail) => new Promise((resolve) => {
      if (cancelled) return resolve(false);
      pending = resolve; log(`confirmation ${JSON.stringify({ ...detail, id: ++sequence })}`);
    }) : undefined,
    close: () => { signals.removeListener('SIGINT', interrupt); signals.removeListener('SIGTERM', cancel); lines?.close(); },
  };
}
