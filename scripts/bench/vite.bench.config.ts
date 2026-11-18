/**
 * Builds the playback bench page (scripts/bench/index.html) with the same
 * worker and WASM handling as the npm library build.
 *
 *   npx vite build --config scripts/bench/vite.bench.config.ts --outDir <dir>
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repo = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: '@/workers/workerManager',
        replacement: path.join(repo, 'src/platform/workers/workerManager.ts'),
      },
      {
        find: '@/workers/wasmUrl',
        replacement: path.join(repo, 'src/platform/workers/wasmUrl.ts'),
      },
      {
        find: 'react-i18next',
        replacement: path.join(repo, 'src/react/i18n/reactI18nextCompat.ts'),
      },
      { find: /^@\/core(?:\/|$)/, replacement: path.join(repo, 'src/core') + '/' },
      { find: /^@\/platform(?:\/|$)/, replacement: path.join(repo, 'src/platform') + '/' },
      { find: /^@\/ui(?:\/|$)/, replacement: path.join(repo, 'src/ui') + '/' },
      { find: /^@\//, replacement: path.join(repo, 'src/react') + '/' },
    ],
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    emptyOutDir: true,
    minify: process.env.BENCH_MINIFY !== '0',
    outDir: path.join(repo, 'scripts/bench/dist'),
  },
});
