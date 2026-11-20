// Verify the webview parser bundle with no Node globals, against the Node parser.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseHangarPage, parseBuybackPage } from '../src/parse.mjs';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const { build } = await import(require.resolve('vite'));
const result = await build({ configFile: false, logLevel: 'warn', build: {
  write: false, lib: { entry: fileURLToPath(new URL('../src/parse.mjs', import.meta.url)), name: 'Parser', formats: ['iife'] },
} });
const context = { URL, atob };
const bundle = Array.isArray(result) ? result[0] : result;
vm.runInNewContext(bundle.output[0].code, context);
for (const [fixture, parse] of [['sync-hangar.html', parseHangarPage], ['sync-buyback.html', parseBuybackPage]]) {
  const html = fs.readFileSync(new URL(`../test/fixtures/${fixture}`, import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(JSON.stringify(context.Parser[parse.name](html))), parse(html));
}
console.log('Browser bundle parser parity passed on two fixtures, without Node globals or DOM APIs.');
