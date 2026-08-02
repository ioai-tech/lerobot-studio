import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import dts from 'vite-plugin-dts';
import { cssScopePlugin } from './vite/cssScopePlugin';

export default defineConfig({
  publicDir: false,
  plugins: [
    react(),
    tailwindcss(),
    cssScopePlugin({ rootClass: 'lerobot-root' }),
    dts({
      tsconfigPath: './tsconfig.lib.json',
      entryRoot: 'src',
      outDir: 'dist-lib',
      rollupTypes: false,
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@/workers/wasmUrl',
        replacement: path.resolve(__dirname, './src/platform/workers/wasmUrl.inline.ts'),
      },
      {
        find: '@/workers/workerManager',
        replacement: path.resolve(__dirname, './src/platform/workers/workerManager.ts'),
      },
      {
        find: 'react-i18next',
        replacement: path.resolve(__dirname, './src/react/i18n/reactI18nextCompat.ts'),
      },
      { find: /^@\/core(?:\/|$)/, replacement: path.resolve(__dirname, './src/core') },
      { find: /^@\/platform(?:\/|$)/, replacement: path.resolve(__dirname, './src/platform') },
      { find: /^@\/ui(?:\/|$)/, replacement: path.resolve(__dirname, './src/ui') },
      { find: /^@$/, replacement: path.resolve(__dirname, './src/react/index.ts') },
      { find: /^@\//, replacement: path.resolve(__dirname, './src/react') + '/' },
    ],
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    legacy: { inconsistentCjsInterop: true },
    outDir: 'dist-lib',
    emptyOutDir: true,
    lib: { entry: 'src/react/index.ts', formats: ['es'], fileName: 'lerobot.es' },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', /^use-sync-external-store(?:\/.*)?$/],
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css')
            ? 'lerobot-studio.css'
            : assetInfo.name || '[name][extname]',
      },
    },
    cssCodeSplit: false,
  },
});
