#!/usr/bin/env node
// MCP server (stdio) for the CCU planner: node scripts/mcp.mjs [--allow-writes]
// Reads the same data folder as the app (CCU_DATA overrides it). Without --allow-writes no tool changes your plans.
// stdout carries the protocol; everything else goes to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../src/mcp/server.mjs';
import { createNodeDeps } from '../src/mcp/node-deps.mjs';
import { DATA_DIR, ensureDefaultDataDir } from '../src/data.mjs';
import { refreshFeed } from '../src/feed.mjs';

ensureDefaultDataDir(); // before anything can create the new folder

const args = process.argv.slice(2);
const known = new Set(['--allow-writes']);
const unknown = args.filter((a) => !known.has(a));
if (unknown.length) {
  console.error(`unknown option ${unknown.join(' ')}\nusage: node scripts/mcp.mjs [--allow-writes]`);
  process.exit(2);
}
const allowWrites = args.includes('--allow-writes');
const server = createServer(createNodeDeps(), { allowWrites });
await server.connect(new StdioServerTransport());
// The signed feed (sale events): one background check at start, at most every 6 hours; offline or refused changes nothing and prints nothing.
refreshFeed({ dir: DATA_DIR }).catch(() => {});
console.error(`ccu-planner MCP server ready (data: ${DATA_DIR}, writes ${allowWrites ? 'ENABLED' : 'off'})`);
