import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

/**
 * Browser-mode Vitest config for tests that need real video/audio APIs
 * and a full WASM runtime for parquet-wasm.
 *
 * Run with: `npm run test:browser`.
 * First-time setup: `npx playwright install chromium`.
 */
export default defineConfig({
  plugins: [react()],
  // Serve workspace fixtures at /tests/fixtures/... for FetchDataSource.
  publicDir: false,
  server: {
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
  resolve: {
    alias: {
      '@ioai/lerobot-studio': path.resolve(__dirname, './packages/react/src/index.ts'),
      '@ioai/lerobot-studio-core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@ioai/lerobot-studio-platform': path.resolve(__dirname, './packages/platform/src/index.ts'),
      '@ioai/lerobot-studio-ui': path.resolve(__dirname, './packages/ui/src/index.ts'),
      'react-i18next': path.resolve(__dirname, './packages/react/src/i18n/reactI18nextCompat.ts'),
      '@': path.resolve(__dirname, './packages/react/src'),
    },
  },
  test: {
    include: ['tests/browser/**/*.browser.spec.ts', 'tests/browser/**/*.browser.spec.tsx'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    reporters: ['default'],
  },
});
