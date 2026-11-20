// The dev server keeps using the CLI's Chrome profile; no cookie values leave this process.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { loadSession, interactiveLogin, PROFILE_DIR, SESSION_FILE } from '../src/session.mjs';
try {
  switch (process.argv[2]) {
    case 'status': console.log(loadSession() ? 'signed in' : 'none'); break;
    case 'login': await interactiveLogin(); break;
    case 'logout': {
      const context = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless: true });
      try { await context.clearCookies(); } finally { await context.close(); }
      fs.rmSync(SESSION_FILE, { force: true });
      console.log('none'); break;
    }
    default: throw new Error('Unknown session action');
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
