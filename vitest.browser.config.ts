import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { localDatasetPlugin } from './scripts/vite/localDatasetPlugin.ts';
import { logNetworkFailures } from './scripts/vite/browserNetworkLog.ts';
import { wasmTestControlPlugin } from './scripts/vite/wasmTestControlPlugin.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), localDatasetPlugin(), wasmTestControlPlugin()],
  publicDir: false,
  // parquet-wasm is imported only by the worker modules, which the start-up
  // dependency scan does not reach. Without this, its first use re-optimizes
  // and reloads the dev server mid-session (a test file then fails to import).
  optimizeDeps: { include: ['parquet-wasm'] },
  server: { fs: { allow: [path.resolve(import.meta.dirname)] } },
  resolve: {
    alias: {
      '@/workers/workerManager': path.resolve(
        import.meta.dirname,
        './src/platform/workers/workerManager.ts',
      ),
      '@/workers/wasmUrl': path.resolve(import.meta.dirname, './src/platform/workers/wasmUrl.ts'),
      '@/core': path.resolve(import.meta.dirname, './src/core/index.ts'),
      '@/platform': path.resolve(import.meta.dirname, './src/platform/index.ts'),
      '@/ui': path.resolve(import.meta.dirname, './src/ui/index.ts'),
      'react-i18next': path.resolve(import.meta.dirname, './src/react/i18n/reactI18nextCompat.ts'),
      '@': path.resolve(import.meta.dirname, './src/react'),
    },
  },
  test: {
    include: ['tests/browser/**/*.browser.spec.ts', 'tests/browser/**/*.browser.spec.tsx'],
    globalSetup: ['tests/browser/support/rangeServer.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    setupFiles: ['tests/browser/setup/networkLog.ts'],
    browser: {
      enabled: true,
      commands: { logNetworkFailures },
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    reporters: ['default'],
  },
});
