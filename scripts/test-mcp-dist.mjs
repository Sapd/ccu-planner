// Exercise the actual release entry points from outside the checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { toolsFor } from '../src/mcp/tools.mjs';
import { fixtureCopy } from '../test/support/mcp-fixture.mjs';

const platform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform];
const exe = `ccu-planner-mcp-${platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
const dir = fixtureCopy();
try {
  for (const [command, args] of [
    [process.execPath, [path.resolve('dist/mcp/server/index.mjs')]],
    [path.resolve('dist', exe), []],
  ]) {
    for (const setting of [undefined, 'false', 'TRUE', 'true']) {
      const env = { CCU_DATA: dir, NODE_ENV: 'test', CCU_FEED_URL: 'http://127.0.0.1:1/' };
      if (setting !== undefined) env.CCU_MCP_ALLOW_WRITES = setting;
      const client = new Client({ name: 'dist-test', version: '1' });
      try {
        await client.connect(new StdioClientTransport({ command, args, cwd: dir, env }));
        const names = (await client.listTools()).tools.map(t => t.name).sort();
        assert.deepEqual(names, toolsFor({ allowWrites: setting === 'true' }).map(t => t.name).sort());
        for (const name of ['goals', 'today']) {
          const result = await client.callTool({ name, arguments: {} });
          assert.ok(!result.isError, result.content[0].text);
          assert.ok(result.structuredContent);
        }
        const sync = await client.callTool({ name: 'sync_hangar', arguments: {} });
        assert.equal(sync.isError, true);
        assert.match(sync.content[0].text, /No stored RSI session.*Sync in the planner app/);
      } finally {
        await client.close();
      }
    }
    console.log(`Passed stdio checks for ${args[0] ?? exe}`);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
