import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import config from '../app/src-tauri/tauri.conf.json' with { type: 'json' };
import { TOOLS } from '../src/mcp/tools.mjs';

const stage = 'dist/mcp';
const entry = 'server/index.mjs';
const url = 'https://github.com/Sapd/ccu-planner';
const bunVersion = '1.4.2';
const bun = process.env.BUN || 'bun';
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
if (execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim() !== bunVersion) {
  throw new Error(`Building release executables requires Bun ${bunVersion}`);
}

fs.rmSync(stage, { recursive: true, force: true });
await build({
  entryPoints: ['scripts/mcp.mjs'], outfile: `${stage}/${entry}`,
  platform: 'node', format: 'esm', target: 'node22', bundle: true,
  define: { 'import.meta.ccuPackaged': 'true' },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
const manifest = {
  manifest_version: '0.3', name: 'ccu-planner', display_name: 'CCU Planner', version: config.version,
  description: 'Ask Claude about your Star Citizen upgrade plan using data saved by CCU Planner.',
  author: { name: 'Sapd' }, repository: { type: 'git', url }, homepage: url, license: 'GPL-3.0-only',
  server: {
    type: 'node', entry_point: entry,
    mcp_config: {
      command: 'node', args: ['${__dirname}/server/index.mjs'],
      env: { CCU_MCP_ALLOW_WRITES: '${user_config.allow_writes}', CCU_DATA: '${user_config.data_folder}' },
    },
  },
  user_config: {
    allow_writes: { type: 'boolean', title: 'Let Claude change my plan', default: false,
      description: 'Allow Claude to edit your local plan. It can never buy, melt, gift or apply anything on RSI.' },
    data_folder: { type: 'directory', title: 'Data folder', required: false, default: '',
      description: 'Leave empty to use the data folder shared with the planner app.' },
  },
  tools: TOOLS.map(({ name, description }) => ({ name, description })),
  compatibility: { platforms: ['darwin', 'win32', 'linux'] },
};
fs.writeFileSync(`${stage}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
const mcpb = (...args) => run('npx', ['--yes', '@anthropic-ai/mcpb@2.1.2', ...args]);
mcpb('validate', `${stage}/manifest.json`);
mcpb('pack', stage, 'dist/ccu-planner.mcpb');

for (const [target, suffix] of [
  ['bun-windows-x64', 'windows-x64.exe'], ['bun-darwin-arm64', 'macos-arm64'],
  ['bun-darwin-x64', 'macos-x64'], ['bun-linux-x64', 'linux-x64'],
]) {
  run(bun, ['build', '--compile', '--target', target, `${stage}/${entry}`, '--outfile', `dist/ccu-planner-mcp-${suffix}`]);
}
