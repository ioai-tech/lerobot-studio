import path from 'node:path';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const smokeTests = [
  'tests/browser/browser-compatibility.browser.spec.tsx',
  'tests/browser/frontend-experience.browser.spec.tsx',
  'tests/browser/read-only-episodes.browser.spec.tsx',
  'tests/browser/ui-primitives.browser.spec.tsx',
];
const supportedBrowsers = ['chromium', 'firefox', 'webkit'] as const;
const requestedBrowser = process.env.VITEST_BROWSER;
if (
  requestedBrowser &&
  !supportedBrowsers.includes(requestedBrowser as (typeof supportedBrowsers)[number])
) {
  throw new Error(`Unsupported VITEST_BROWSER value: ${requestedBrowser}`);
}
const browserInstances = (
  requestedBrowser
    ? [requestedBrowser as (typeof supportedBrowsers)[number]]
    : [...supportedBrowsers]
).map((browser) => ({ browser }));

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
    include: smokeTests,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: browserInstances,
    },
    reporters: ['default'],
  },
});
