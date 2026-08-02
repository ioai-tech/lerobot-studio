import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@ioai/lerobot-studio': path.resolve(__dirname, './packages/react/src/index.ts'),
      '@ioai/lerobot-studio-core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@ioai/lerobot-studio-platform': path.resolve(__dirname, './packages/platform/src/index.ts'),
      '@ioai/lerobot-studio-ui': path.resolve(__dirname, './packages/ui/src/index.ts'),
      'react-i18next': path.resolve(__dirname, './packages/react/src/i18n/reactI18nextCompat.ts'),
      '@': path.resolve(__dirname, './packages/react/src'),
      '@/workers/workerManager': path.resolve(
        __dirname,
        './packages/platform/src/workers/workerManager.ts',
      ),
      '@/workers/wasmUrl': path.resolve(__dirname, './packages/platform/src/workers/wasmUrl.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/browser/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 45,
      },
    },
  },
});
