import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
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
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/browser/**'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], thresholds: { lines: 45 } },
  },
});
