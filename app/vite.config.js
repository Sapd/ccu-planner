import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import devData from './vite-dev-data.js';

export default defineConfig({
  plugins: [svelte(), devData()],
  resolve: {
    alias: { $logic: fileURLToPath(new URL('../src/logic', import.meta.url)) },
  },
  worker: { format: 'es' },
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ['.', '../src'], deny: ['**/.local/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
});
