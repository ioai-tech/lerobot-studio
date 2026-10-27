import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { localDatasetPlugin } from './scripts/vite/localDatasetPlugin.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), localDatasetPlugin()],
  publicDir: false,
  // The parquet worker imports hyparquet; Vite's dependency scan does not see worker imports, and a
  // late discovery re-optimises and reloads the page mid-test (releasing Comlink proxies).
  // Every dependency a test or a lazy chunk imports is pre-bundled up front: one found late (a
  // first run after `npm ci`, with an empty cache) re-optimises mid-run, and the page's pending
  // dynamic imports fail ("Failed to fetch dynamically imported module").
  optimizeDeps: {
    entries: ['tests/browser/**/*.browser.spec.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    include: [
      'hyparquet',
      'apache-arrow',
      'comlink',
      'mediabunny',
      '@zip.js/zip.js',
      'fflate',
      'uplot',
      'dockview-react',
      'lucide-react',
      'radix-ui',
      'react-dom/client',
      'react-window',
      'sonner',
      'framer-motion',
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
      'next-themes',
      'react-intl',
      'axe-core',
    ],
  },
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
      // a user action that never becomes possible fails with the locator it waited for, instead
      // of hanging until the test timeout
      provider: playwright({ actionTimeout: 60_000 }),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    reporters: ['default'],
  },
});
