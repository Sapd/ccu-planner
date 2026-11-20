// Fixture-only smoke check. Never signs in or sends an RSI request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { parseHangarPage, parseBuybackPage } from '../src/parse.mjs';
const appRequire = createRequire(new URL('../app/package.json', import.meta.url));
const { createServer } = await import(appRequire.resolve('vite'));
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-sync-browser-'));
const raw = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/raw-small.json')));
for (const [key, name] of [['catalog','catalog'],['details','ship-details'],['hangar','hangar'],['buyback','buyback']]) {
  if (raw[key]) fs.writeFileSync(path.join(temp, `${name}.json`), JSON.stringify(raw[key]));
}
fs.mkdirSync(path.join(temp, 'upgrades'));
for (const u of raw.upgrades) fs.writeFileSync(path.join(temp, `upgrades/${u.fromId}.json`), JSON.stringify(u));
process.env.CCU_DATA = temp;
const server = await createServer({ root: path.join(root, 'app'), configLoader: 'runner', cacheDir: path.join(temp, 'vite'), server: { port: 1420, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort();
    return route.continue();
  });
  await page.route('**/__dev/session-status', (r) => r.fulfill({ json: 'signed in' }));
  await page.route('**/__dev/sync-start', (r) => r.fulfill({ json: { running: true } }));
  let polls = 0;
  await page.route('**/__dev/sync-status', (r) => r.fulfill({ json: ++polls < 3 ? { running: true, progress: { phase: 'upgrades', done: 1, total: 3 } } : { running: false } }));
  await page.goto('http://localhost:1420');
  await page.getByRole('button', { name: 'Sync ▾', exact: true }).waitFor();
  assert.match(await page.locator('.stamps').innerText(), /Store:.*Hangar:/);
  assert.ok((await page.locator('.stamps').getAttribute('class')).includes('stale'));
  for (const [fixture, parser] of [['sync-hangar.html', parseHangarPage],['sync-buyback.html', parseBuybackPage]]) {
    const html = fs.readFileSync(path.join(root, 'test/fixtures', fixture), 'utf8');
    const actual = await page.evaluate(async ({ html, root, name }) => {
      const parsers = await import(`/@fs/${root}/src/parse.mjs`);
      return parsers[name](html);
    }, { html, root, name: parser.name });
    assert.deepEqual(actual, parser(html));
  }
  await page.getByRole('button', { name: 'Sync ▾', exact: true }).click();
  await page.getByRole('button', { name: 'Store (about 4–5 min)', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'Sync complete' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: bundled parser fixture parity, timestamps, Sync menu, progress and completion/reload. All external requests blocked; sync mocked.');
} finally {
  await browser?.close(); await server.close(); fs.rmSync(temp, { recursive: true, force: true });
}
