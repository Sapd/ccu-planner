import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import devData, { guardPost, readBody } from '../app/vite-dev-data.js';
import { createSyncRunner } from '../app/dev-sync.js';
import { syncBackend } from '../app/src/lib/sync-backend.js';
import { cliControl } from '../src/sync/cli-control.mjs';
import { appendLines } from '../src/sync/append-lines.mjs';
import { parseHistory } from '../src/logic/mapping.mjs';
import { QUERIES } from '../src/sync/queries.mjs';
import { RsiClient } from '../src/rsi.mjs';

const child = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { throw new Error('Windows must not send SIGINT'); } });

test('dev GET endpoints and legacy /load reject foreign Origin and Sec-Fetch-Site before reading data', async () => {
  const middlewares = new Map();
  devData().configureServer({ middlewares: { use: (route, fn) => middlewares.set(route, fn) } });
  const old = process.env.CCU_DATA; process.env.CCU_DATA = '/nonexistent-fixture';
  try {
    for (const url of ['/load', '/dir', '/session-status', '/sync-status']) {
      for (const headers of [{ host: 'localhost:1420', origin: 'https://foreign.test' }, { host: 'localhost:1420', 'sec-fetch-site': 'cross-site' }]) {
        const req = { method: 'GET', url, headers };
        assert.ok(guardPost(req));
        let body;
        const res = { setHeader() {}, end: (value) => body = JSON.parse(value) };
        await middlewares.get('/__dev')(req, res);
        assert.equal(res.statusCode, 403); assert.match(body.error, /foreign|cross-site/);
      }
    }
  } finally { if (old === undefined) delete process.env.CCU_DATA; else process.env.CCU_DATA = old; }
});

test('readBody accepts 64 KB and rejects larger streamed payloads in bytes', async () => {
  const within = new PassThrough(); const ok = readBody(within);
  within.end(JSON.stringify({ data: 'a'.repeat(65525) }));
  assert.equal((await ok).data.length, 65525);
  const large = new PassThrough(); const rejected = assert.rejects(readBody(large), { status: 413 });
  large.write('a'.repeat(40000)); large.end('b'.repeat(30000)); await rejected;
  const unicode = new PassThrough(); const rejectedUnicode = assert.rejects(readBody(unicode), { status: 413 });
  unicode.end('😀'.repeat(20000)); await rejectedUnicode;
});

test('Windows dev cancellation and confirmation use stdin; sync is refused during login', async () => {
  const login = child(), sync = child(); let calls = 0, wire = '';
  sync.stdin.on('data', (b) => wire += b);
  const runner = createSyncRunner('/fixture', (exe, args, options) => {
    if (calls++ === 0) { assert.deepEqual(args, ['scripts/dev-session.mjs', 'login']); return login; }
    assert.equal(options.stdio[0], 'pipe'); assert.equal(options.env.CCU_SYNC_INTERACTIVE, '1'); return sync;
  }, 'win32');
  const signingIn = runner.session('login');
  assert.throws(() => runner.start('hangar'), /login is pending/);
  login.emit('close', 0); await signingIn;
  runner.start('hangar');
  sync.stdout.write('confirmation {"id":1,"message":"question"}\n');
  assert.equal(runner.status().confirmation.message, 'question');
  runner.confirm(1, true); runner.cancel();
  assert.deepEqual(wire.trim().split('\n').map(JSON.parse), [{ type: 'confirm', id: 1, accept: true }, { type: 'cancel' }]);
  sync.emit('close', 130); assert.equal(runner.status().running, false);
});

test('CLI control asks once, accepts matching confirmation, cancels cooperatively, and second Ctrl-C exits', async () => {
  const input = new PassThrough(), signals = new EventEmitter(), logs = [], exits = [];
  const control = cliControl({ input, signals, interactive: true, log: (s) => logs.push(s), exit: (code) => exits.push(code) });
  const decision = control.confirmOverwrite({ message: 'RSI returned 1 of 10 pledges. Overwrite anyway?' });
  assert.match(logs[0], /^confirmation /);
  input.write('{"type":"confirm","id":1,"accept":true}\n'); assert.equal(await decision, true);
  const second = control.confirmOverwrite({ message: 'again' });
  input.write('{"type":"cancel"}\n'); assert.equal(await second, false); assert.equal(control.cancelled(), true);
  signals.emit('SIGINT'); assert.deepEqual(exits, [130]); control.close();
  const other = cliControl({ signals, interactive: false, exit: (code) => exits.push(code) });
  signals.emit('SIGINT'); assert.deepEqual(exits, [130]); signals.emit('SIGINT'); assert.deepEqual(exits, [130,130]); other.close();
});

test('dev backend forwards the overwrite decision to the existing CLI child', async () => {
  const actions = []; let polls = 0;
  const backend = syncBackend(() => false, () => {}, async (op, body) => {
    actions.push([op, body]);
    if (op === 'sync-status') return { running: false, confirmation: ++polls === 1 ? { id: 7, current: 1, previous: 10, message: 'RSI returned 1 of 10 pledges. Overwrite anyway?' } : null };
  });
  await backend.sync('hangar', () => {}, { confirmOverwrite: async ({ message }) => { assert.match(message, /1 of 10/); return true; } });
  assert.ok(actions.some(([op, body]) => op === 'sync-confirm' && body.id === 7 && body.accept));
});

test('CLI unknown command exits 2 without loading credentials or making a request', () => {
  const result = spawnSync(process.execPath, ['scripts/sync.mjs', 'not-a-command'], { encoding: 'utf8', env: { ...process.env, CCU_DATA: '/nonexistent-fixture' } });
  assert.equal(result.status, 2); assert.match(result.stderr, /usage:/);
});

test('O_APPEND preserves earlier history and separates a torn tail before the next good line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-append-'));
  try {
    const file = path.join(dir, 'offer-history.jsonl');
    fs.writeFileSync(file, '{"old":1}\n{"torn');
    appendLines(file, '{"new":2}\n{"new":3}');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"old":1}\n{"torn\n{"new":2}\n{"new":3}\n');
    assert.deepEqual(parseHistory(fs.readFileSync(file, 'utf8')), [{ old: 1 }, { new: 2 }, { new: 3 }]);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

for (const [probeStatus, location, expected] of [[200, '', 'RSI refused the request (403)'], [403, '', 'RSI refused the request (403)'], [302, '/en/signin', 'RSI session missing or expired']]) {
  test(`CLI 403 requires a confirming login redirect (probe ${probeStatus})`, async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      requests.push(url);
      return new Response('', { status: requests.length === 1 ? 403 : probeStatus, headers: { location } });
    });
    const client = new RsiClient({ minIntervalMs: 0 }); client.session = { userAgent: 'test', csrf: 'test' };
    await assert.rejects(client.request('/en/account/pledges?page=1', { retried: true }), new RegExp(expected.replace(/[()]/g, '\\$&')));
    assert.equal(requests.length, 2); assert.ok(requests[1].endsWith('/en/account/pledges?page=1&pagesize=1'));
  });
}

test('a late close from a failed login cannot release the next pending login', async () => {
  const first = child(), second = child(); let calls = 0;
  const runner = createSyncRunner('/fixture', () => calls++ === 0 ? first : second);
  const failed = assert.rejects(runner.session('login'), /failed spawn/);
  first.emit('error', new Error('failed spawn')); await failed;
  const pending = runner.session('login');
  first.emit('close', 1);
  assert.throws(() => runner.start('hangar'), /login is pending/);
  second.emit('close', 0); await pending;
});

test('cooperative cancellation stops a CLI retry before any further request', async (t) => {
  let cancelled = false, requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; cancelled = true; return new Response('', { status: 429 }); });
  const client = new RsiClient({ minIntervalMs: 0, cancelled: () => cancelled });
  client.session = { userAgent: 'test', csrf: 'test' };
  await assert.rejects(client.request('/en/account/pledges?page=1'), /Sync cancelled/);
  assert.equal(requests, 1);
});

for (const failsAgain of [false, true]) {
  test(`CLI retries the original GraphQL request once with refreshed CSRF (repeat 403: ${failsAgain})`, async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push({ url, ...options });
      const n = requests.length;
      if (n === 1 || (n === 3 && failsAgain)) return new Response('', { status: 403 });
      if (n === 2 || n === 4) return new Response(`<meta name="csrf-token" content="fresh-${n}">`);
      return new Response('success');
    });
    const client = new RsiClient({ minIntervalMs: 0 }); client.session = { userAgent: 'test', csrf: 'stale' };
    const options = { method: 'POST', json: [{ operationName: 'initShipUpgrade', variables: {}, query: QUERIES.initShipUpgrade }], headers: { 'x-csrf-token': 'stale' } };
    const result = client.request('/pledge-store/api/upgrade/v2/graphql', options);
    if (failsAgain) await assert.rejects(result, /RSI refused the request \(403\)/);
    else assert.equal(await (await result).text(), 'success');
    assert.equal(requests.length, failsAgain ? 4 : 3);
    assert.equal(requests[2].headers['x-csrf-token'], 'fresh-2');
    assert.equal(requests[0].url, requests[2].url);
    assert.equal(requests[0].method, requests[2].method);
    assert.equal(requests[0].body, requests[2].body);
    assert.ok(requests[1].url.endsWith('/en/account/pledges?page=1&pagesize=1'));
  });
}

test('Windows sync-images cancellation travels through stdin into the real CLI', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-image-cancel-'));
  let proc;
  try {
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ ships: [1, 2].map((id) => ({ id, name: `S${id}`, link: `/pledge/ships/x/S${id}` })) }));
    // No real network: hold the first fixture fetch until the cancellation
    // message reaches the same stdin stream used by the script's CLI control.
    const preload = path.join(dir, 'fetch-fixture.mjs');
    fs.writeFileSync(preload, `globalThis.fetch = async () => {
      process.stdout.write('fixture-request\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      return new Response('', { status: 403 });
    };`);
    let requests = 0, output = '', errors = '';
    const runner = createSyncRunner(dir, (exe, args, options) => {
      assert.deepEqual(args, ['scripts/sync-images.mjs']);
      assert.equal(options.stdio[0], 'pipe');
      assert.equal(options.env.CCU_SYNC_INTERACTIVE, '1');
      proc = spawn(exe, ['--import', pathToFileURL(preload).href, ...args], { ...options, signal: t.signal });
      proc.stdout.on('data', (data) => {
        output += data;
        if (String(data).includes('fixture-request')) { requests++; runner.cancel(); }
      });
      proc.stderr.on('data', (data) => errors += data);
      return proc;
    }, 'win32');
    runner.start('images');
    const code = await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('close', resolve); });
    assert.equal(code, 130, errors);
    assert.equal(requests, 1);
    assert.match(output, /0 found, 0 failed, 1 fetched/);
    assert.equal(fs.existsSync(path.join(dir, 'ship-images.json')), false);
    assert.equal(runner.status().running, false);
    assert.match(runner.status().error, /Sync cancelled/);
  } finally {
    if (proc && proc.exitCode === null) proc.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop backend forwards the login persistence warning to the UI', async () => {
  const warning = "Signed in, but the session couldn't be saved; you'll need to sign in again next time";
  const backend = syncBackend(() => true, async (op) => { assert.equal(op, 'rsi_login'); return warning; }, () => assert.fail('desktop only'));
  assert.equal(await backend.login(), warning);
});


test('shared sign-in-form rule matches the native client fixtures', async () => {
  const { hasSigninForm } = await import('../src/sync/signin.mjs');
  const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/signin-forms.json', import.meta.url), 'utf8'));
  for (const [html, expected] of cases) assert.equal(hasSigninForm(html), expected, html);
});

test('session probe applies the shared rule per form tag and treats navigation errors as undetermined', async () => {
  const { readSessionFrom } = await import('../src/session.mjs');
  const page = (forms, { fail = false } = {}) => ({
    goto: async () => { if (fail) throw new Error('net::ERR_ABORTED'); return {}; },
    url: () => 'https://robertsspaceindustries.com/en/account/pledges',
    $$eval: async (_sel, fn) => fn(forms.map((outerHTML) => ({ outerHTML }))),
    locator: () => ({ count: async () => 1, getAttribute: async () => 'csrf' }),
    evaluate: async () => 'HeadlessChrome UA',
  });
  const context = { cookies: async () => [{ name: 'Rsi-Token', value: 'x', domain: 'd', path: '/', expires: 1 }] };
  const ok = await readSessionFrom(context, page(['<form action="/en/account/login-history" method="get">', '<form action="/en/account/logout">']));
  assert.equal(ok.csrf, 'csrf');
  assert.equal(await readSessionFrom(context, page(['<form class="js-signin-form" action="/x">'])), null);
  assert.equal(await readSessionFrom(context, page(['<form action="/en/signin">'])), null);
  assert.equal(await readSessionFrom(context, page([], { fail: true })), null);
  // Only the cookies the desktop app keeps are stored (the shared list in src/sync/session-cookies.json).
  const many = { cookies: async () => ['Rsi-Token', 'Rsi-Account-Auth', 'cf_clearance', '__cf_bm', '__cflb', '_ga', 'analytics', 'rsi-lower', 'cf_other'].map((name) => ({ name, value: 'v', domain: 'd', path: '/', expires: 1 })) };
  assert.deepEqual((await readSessionFrom(many, page([]))).cookies.map((c) => c.name), ['Rsi-Token', 'Rsi-Account-Auth', 'cf_clearance', '__cf_bm', '__cflb']);
});

test('the desktop sync result carries the core warning about a non-USD account', async () => {
  const files = new Map();
  const invoke = async (op, args) => {
    if (op === 'rsi_request') {
      const names = args.body.map((b) => b.operationName);
      if (names[0] === 'initShipUpgrade') return [{ data: { app: { pricing: { currencyCode: 'EUR', currencySymbol: '€', exponent: 2 } }, manufacturers: [], ships: [] } }];
      return [{ data: { from: { ships: [] }, to: { ships: [] } } }];
    }
    if (op === 'sync_read') return files.get(args.name) ?? null;
    if (op === 'sync_write') { files.set(args.name, args.value); return null; }
    return null;
  };
  const backend = syncBackend(() => true, invoke, () => assert.fail('desktop only'), async () => () => {});
  const result = await backend.sync('upgrades', () => {});
  assert.ok(result.warnings.some((w) => /session currency is EUR/.test(w)), JSON.stringify(result));
});

test('the desktop sync begins by taking the shared lock, ends by releasing it, and is refused while another sync holds it', async () => {
  const calls = [];
  const busy = syncBackend(() => true, async (op) => { calls.push(op); if (op === 'rsi_begin_sync') throw new Error('Another sync is running (started 2026-11-19T10:00:00.000Z, pid 7).'); }, () => {}, async () => () => {});
  await assert.rejects(busy.sync('hangar'), /^Error: Another sync is running \(started /);
  assert.deepEqual(calls, ['rsi_begin_sync'], 'nothing is released that was never taken, and nothing else ran');
  const ended = [];
  const failing = syncBackend(() => true, async (op) => { ended.push(op); if (op === 'rsi_request') throw new Error('boom'); return null; }, () => {}, async () => () => {});
  await assert.rejects(failing.sync('hangar'), /boom/);
  assert.equal(ended[0], 'rsi_begin_sync');
  assert.equal(ended.at(-1), 'rsi_end_sync');
});

test('the desktop store catalog sync takes the lock, sends only the pinned /graphql query through rsi_request, caches pictures through Rust and takes no plan snapshot', async () => {
  const { validateRequest } = await import('../src/sync/policy.mjs');
  const calls = [], files = {};
  const item = (id) => ({ id: String(id), title: `Item ${id}`, url: `/pledge/Standalone-Ships/Item-${id}`, media: { thumbnail: { storeSmall: `https://media.robertsspaceindustries.com/${id}/s.jpg` } },
    nativePrice: { amount: 5000, discounted: null }, stock: { unlimited: true, available: true, qty: 0 }, tags: [], isVip: id === 2 });
  const invoke = async (op, args) => {
    calls.push(op);
    if (op === 'rsi_request') {
      validateRequest(args.method, args.path, args.body);
      assert.equal(args.path, '/graphql');
      const list = args.body.variables.query.skus.products[0] === 72 ? [item(1), item(2)] : [];
      return { data: { store: { listing: { resources: list, count: list.length, totalCount: list.length } } } };
    }
    if (op === 'sync_read') return args.name === 'images/catalog' ? [] : files[args.name] ?? null;
    if (op === 'sync_write') { files[args.name] = args.value; return null; }
    if (op === 'rsi_cache_catalog_image') { assert.match(args.url, /^https:\/\/media\.robertsspaceindustries\.com\//); return `catalog/${args.id}.jpg`; }
    return null;
  };
  const backend = syncBackend(() => true, invoke, () => assert.fail('desktop only'), async () => () => {});
  const result = await backend.sync('store-catalog', () => {});
  assert.deepEqual(result, { warnings: [] });
  assert.equal(calls[0], 'rsi_begin_sync');
  assert.equal(calls.at(-1), 'rsi_end_sync');
  assert.ok(!calls.includes('plan_snapshot') && !calls.some((c) => /snapshot/i.test(c)));
  const doc = files['store-catalog.json'];
  assert.equal(doc.signedIn, true);
  assert.deepEqual(doc.items.map((i) => [i.id, i.thumb]), [[1, 'catalog/1.jpg'], [2, 'catalog/2.jpg']]);
});

test('a 401 on the store catalog query is a catalog failure and does not mark the RSI session expired', async (t) => {
  const { catalogBody } = await import('../src/sync/catalog-query.mjs');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => { requests.push(url); return new Response('', { status: 401 }); });
  const client = new RsiClient({ minIntervalMs: 0 }); client.session = { userAgent: 'test', csrf: 'test' };
  await assert.rejects(client.request('/graphql', { method: 'POST', json: catalogBody([72], 1) }), (e) => /store catalog request \(401\)/.test(e.message) && e.name !== 'NeedLoginError');
  assert.equal(requests.length, 1, 'no session refresh, no retry');
});
