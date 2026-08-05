import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
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
