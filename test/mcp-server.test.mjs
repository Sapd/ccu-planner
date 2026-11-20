// End to end: a real MCP client over an in-memory transport against the server, and the real data folder code on a copy of the store fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport as ServerTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/mcp/server.mjs';
import { createNodeDeps } from '../src/mcp/node-deps.mjs';
import { world } from './support/mcp-world.mjs';
import { copy } from './support/ladder.mjs';

async function connect(deps, options) {
  const server = createServer(deps, options);
  const [a, b] = ServerTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

// A data folder written from test/fixtures/raw-small.json (ships Alpha, Beta, ...), never from real data.
const fixtureCopy = () => {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/raw-small.json', import.meta.url), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-mcp-'));
  const put = (name, value) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value)); };
  // The server refuses a catalog that names no currency, so the copy names USD.
  put('catalog.json', { ...raw.catalog, app: { ...raw.catalog.app, pricing: { currencyCode: 'USD', currencySymbol: '$', exponent: 2 } } });
  put('ship-details.json', raw.details);
  raw.upgrades.forEach((u, i) => put(`upgrades/u${i}.json`, u));
  put('hangar.json', raw.hangar);
  put('buyback.json', raw.buyback);
  put('offer-history.jsonl', raw.history);
  return dir;
};

test('lists the read-only and sync tools without --allow-writes, and calls today', async () => {
  const w = world({ goals: [{ base: 1, target: 4, mode: 'finish' }], owned: [copy('x', 1, 3)] });
  const { client, close } = await connect(w.deps);
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.deepEqual(names, ['today', 'goals', 'goal', 'changes_since_sync', 'what_if', 'check_offer', 'compare_ccugame', 'hangar_ccus_into', 'sync_hangar', 'sync_store']);
  for (const n of ['add_goal', 'remove_goal', 'accept', 'lock', 'unlock', 'set_credit', 'price_override']) assert.ok(!names.includes(n), n);
  const r = await client.callTool({ name: 'today', arguments: {} });
  assert.ok(!r.isError);
  assert.match(r.content[0].text, /Liberator/);
  assert.ok(Array.isArray(r.structuredContent.buy));
  // a write tool is not just hidden: calling it fails
  await assert.rejects(client.callTool({ name: 'set_credit', arguments: { dollars: 5 } }), /not found/);
  assert.deepEqual(w.saves, []);
  await close();
});

test('the client gets the CCU primer, and every tool it names exists', async () => {
  const { INSTRUCTIONS } = await import('../src/mcp/server.mjs');
  const w = world({ goals: [{ base: 1, target: 4 }] });
  const { client, close } = await connect(w.deps, { allowWrites: true });
  assert.equal(client.getInstructions(), INSTRUCTIONS);
  assert.match(INSTRUCTIONS, /Warbond CCUs are cheaper but .* never store credit/);
  const names = new Set((await client.listTools()).tools.map((t) => t.name));
  const named = INSTRUCTIONS.match(/\b[a-z]+_[a-z_]+\b|\b(?:today|goals|goal|accept|lock|unlock)\b(?= (?:for|and|tool|,|\)))/g).filter((n) => !n.endsWith('_'));
  for (const n of named) assert.ok(names.has(n), `instructions name ${n}, which is no tool`);
  await close();
});

test('--allow-writes adds the write tools; a stale save comes back as an error result', async () => {
  const w = world({ goals: [{ base: 1, target: 4 }] });
  const { client, close } = await connect(w.deps, { allowWrites: true });
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of ['add_goal', 'remove_goal', 'accept', 'lock', 'unlock', 'set_credit', 'price_override']) assert.ok(names.includes(n), n);
  const ok = await client.callTool({ name: 'set_credit', arguments: { dollars: 5 } });
  assert.ok(!ok.isError);
  assert.equal(w.disk.plans.profile.credit, 500);
  const bad = await client.callTool({ name: 'set_credit', arguments: { dollars: -1 } });
  assert.equal(bad.isError, true);
  await close();
});

test('input is validated by the schema; tool errors are results, not crashes', async () => {
  const w = world({ goals: [{ base: 1, target: 4 }] });
  const { client, close } = await connect(w.deps);
  const wrong = await client.callTool({ name: 'goal', arguments: { goal: 7 } });
  assert.equal(wrong.isError, true);
  const unknown = await client.callTool({ name: 'goal', arguments: { goal: 'Idris' } });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /No goal matches/);
  await close();
});

test('sync_store reports progress through notifications and needs a stored session', async () => {
  const w = world({ goals: [{ base: 1, target: 4 }] });
  const { client, close } = await connect(w.deps);
  const none = await client.callTool({ name: 'sync_store', arguments: {} });
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /sign in/i);
  w.state.syncAvailable = true;
  const seen = [];
  const r = await client.callTool({ name: 'sync_store', arguments: {} }, { onprogress: (p) => seen.push(p) });
  assert.ok(!r.isError);
  assert.deepEqual(seen.map((p) => p.progress), [1, 2]);
  assert.deepEqual(seen.map((p) => p.message), ['upgrades 1 of 2', 'upgrades 2 of 2']);
  await close();
});

test('the real data folder code on a copy of the store fixture: reads, and a revisioned write', async () => {
  const dir = fixtureCopy();
  const deps = createNodeDeps({ dir, sessionExists: () => false });
  const { client, close } = await connect(deps, { allowWrites: true });
  const goals = await client.callTool({ name: 'goals', arguments: {} });
  assert.ok(!goals.isError, goals.content[0].text);
  assert.match(goals.content[0].text, /No goals yet/);
  const sync = await client.callTool({ name: 'sync_hangar', arguments: {} });
  assert.equal(sync.isError, true);
  assert.match(sync.content[0].text, /No stored RSI session/);
  assert.ok(!fs.existsSync(path.join(dir, 'price-overrides.json')));
  const before = 0;
  const set = await client.callTool({ name: 'price_override', arguments: { ship: 'Alpha', price: 123 } });
  assert.ok(!set.isError, set.content[0].text);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'price-overrides.json'), 'utf8'));
  assert.equal(doc.rev, before + 1);
  assert.equal(doc.ships[1].msrp, 12300);
  // Another writer moves the file on while this server read the old rev: nothing is overwritten.
  const other = { ...doc, rev: doc.rev + 5, marker: 'other writer' };
  const loadNow = deps.load;
  deps.load = () => { const app = loadNow(); fs.writeFileSync(path.join(dir, 'price-overrides.json'), JSON.stringify(other)); return app; };
  const stale = await client.callTool({ name: 'price_override', arguments: { ship: 'Alpha', price: 456 } });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /Nothing was written/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'price-overrides.json'), 'utf8')).marker, 'other writer');
  await close();
  fs.rmSync(dir, { recursive: true });
});

test('argument caps: long strings and huge amounts are refused by the schema', async () => {
  const w = world({ goals: [{ base: 1, target: 4 }] });
  const { client, close } = await connect(w.deps, { allowWrites: true });
  for (const [name, args] of [['goal', { goal: 'x'.repeat(201) }], ['set_credit', { dollars: 100001 }], ['what_if', { price: { ship: 'Liberator', price: 100001 } }], ['compare_ccugame', { path: `/${'a'.repeat(1030)}.json` }]]) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true, name);
    assert.match(r.content[0].text, /validation/i, name);
  }
  await close();
});

test('a server started without the flag refuses writes even if a write handler is called directly', async () => {
  const w = world({ goals: [{ base: 1, target: 4 }] });
  const { TOOLS } = await import('../src/mcp/tools.mjs');
  const off = { ...w.deps, allowWrites: false };
  for (const name of ['add_goal', 'set_credit', 'lock', 'unlock', 'remove_goal', 'accept', 'price_override']) {
    const args = { add_goal: { target: 'Ironclad' }, set_credit: { dollars: 5 }, price_override: { ship: 'Liberator', price: 5 } }[name] ?? { goal: 'c1' };
    await assert.rejects(TOOLS.find((t) => t.name === name).handler(off, args), /--allow-writes/, name);
  }
  assert.deepEqual(w.saves, []);
  // createServer sets the flag from its option, whatever the deps carry
  const { client, close } = await connect({ ...w.deps, allowWrites: true });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(!names.includes('set_credit'));
  await close();
});
