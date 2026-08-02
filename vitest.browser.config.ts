import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: { fs: { allow: [path.resolve(__dirname)] } },
  resolve: {
    alias: {
      '@/workers/workerManager': path.resolve(__dirname, './src/platform/workers/workerManager.ts'),
      '@/workers/wasmUrl': path.resolve(__dirname, './src/platform/workers/wasmUrl.ts'),
      '@/core': path.resolve(__dirname, './src/core/index.ts'),
      '@/platform': path.resolve(__dirname, './src/platform/index.ts'),
      '@/ui': path.resolve(__dirname, './src/ui/index.ts'),
      'react-i18next': path.resolve(__dirname, './src/react/i18n/reactI18nextCompat.ts'),
      '@': path.resolve(__dirname, './src/react'),
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
