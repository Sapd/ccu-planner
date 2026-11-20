import { randomInt } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { writeDemoData } from './demo-data.mjs';

const appRoot = fileURLToPath(new URL('../app/', import.meta.url));
const output = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const requireFromApp = createRequire(path.join(appRoot, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromApp.resolve('vite')).href);

// Let the real data plugin serve the demo files. The app's background session and
// feed checks are simulated so they cannot launch a sync, read a session or fetch artwork.
const localDataOnly = {
  name: 'screenshots-local-data',
  enforce: 'pre',
  configureServer(server) {
    const reads = new Set(['/load', '/pending', '/catalog', '/feed', '/dir']);
    const simulated = new Map([
      ['GET /session-status', 'signed in'],
      ['POST /feed-refresh', { status: 'offline' }],
      ['POST /feed-images', { downloaded: 0, remaining: 0 }],
    ]);
    server.middlewares.use('/__dev', (req, res, next) => {
      const endpoint = req.url.split('?')[0];
      if (req.method === 'GET' && reads.has(endpoint)) return next();
      const response = simulated.get(`${req.method} ${endpoint}`);
      res.writeHead(response === undefined ? 403 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response ?? { error: 'Only demo data is available during capture' }));
    });
  },
};

const dir = await mkdtemp(path.join(os.tmpdir(), 'ccu-screenshots-'));
let server;
let browser;
try {
  await writeDemoData(dir);
  process.env.CCU_DATA = dir;
  server = await createServer({
    root: appRoot,
    cacheDir: path.join(dir, 'vite-cache'),
    plugins: [localDataOnly],
    server: {
      host: '127.0.0.1', port: randomInt(49152, 65000), strictPort: false,
      watch: null, ws: false, open: false,
    },
  });
  await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await page.goto(origin);
  await nav.waitFor();
  // Dismiss the first-run walkthrough as a returning user would.
  const walkthrough = page.getByRole('dialog').filter({ hasText: 'How CCUs work' });
  await walkthrough.waitFor();
  await walkthrough.press('Escape');
  await walkthrough.waitFor({ state: 'hidden' });

  const capture = async (name, ready, zoom = 1) => {
    await ready.waitFor();
    await page.mouse.move(1439, 899);
    await page.evaluate(async (scale) => {
      document.activeElement?.blur();
      document.documentElement.style.zoom = scale;
      // Keep the app's 100vh scroll container filling the capture viewport at this zoom.
      document.querySelector('.shell').style.height = `calc(100vh / ${scale})`;
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector('main').scrollTop = 0;
    }, zoom);
    const banner = page.locator('[data-hangar-health], [role="alert"], .sample').filter({ visible: true }).first();
    if (await banner.count()) throw new Error(`${name}: ${await banner.innerText()}`);
    if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);
    const shot = await page.screenshot({ animations: 'disabled' });
    const png = { compressionLevel: 9, adaptiveFiltering: true };
    const fullColor = await sharp(shot).png(png).toBuffer();
    const bytes = fullColor.length <= 400_000 ? fullColor : await sharp(shot).png({ ...png, palette: true }).toBuffer();
    return [name, bytes];
  };

  const screenshots = [];
  screenshots.push(await capture('today', page.getByText('Buy now', { exact: true }).first(), 0.76));

  await nav.getByRole('button', { name: 'Goals' }).click();
  await page.getByRole('button', { name: /^Corsair/ }).first().click();
  await page.getByRole('button', { name: /owned upgrades/ }).click();
  screenshots.push(await capture('goals', page.getByRole('heading', { name: 'Corsair' }), 0.94));

  await nav.getByRole('button', { name: 'Hangar' }).click();
  await page.getByRole('button', { name: /^Upgrades \d/ }).click();
  screenshots.push(await capture('hangar', page.locator('[data-ccu-counts]'), 0.90));

  await nav.getByRole('button', { name: 'Store' }).click();
  await page.getByRole('checkbox', { name: 'only my goals' }).check();
  await page.getByText('Sale events (1)', { exact: true }).click();
  screenshots.push(await capture('store', page.locator('#sale-events [data-event]').filter({ hasText: 'Ship Expo' }), 0.79));

  await mkdir(output, { recursive: true });
  for (const [name, bytes] of screenshots) {
    await writeFile(path.join(output, `${name}.png`), bytes);
    console.log(`${name}.png  ${(bytes.length / 1024).toFixed(1)} KiB`);
  }
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
