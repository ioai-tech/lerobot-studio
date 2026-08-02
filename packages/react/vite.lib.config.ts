import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import dts from 'vite-plugin-dts';
import { cssScopePlugin } from './vite/cssScopePlugin';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cssScopePlugin({ rootClass: 'lerobot-root' }),
    dts({
      tsconfigPath: './tsconfig.lib.json',
      entryRoot: 'src',
      outDir: 'dist',
      rollupTypes: true,
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@/workers/wasmUrl',
        replacement: path.resolve(__dirname, '../platform/src/workers/wasmUrl.inline.ts'),
      },
      {
        find: 'react-i18next',
        replacement: path.resolve(__dirname, './src/i18n/reactI18nextCompat.ts'),
      },
      { find: /^@ioai\/lerobot-studio-core$/, replacement: path.resolve(__dirname, '../core/src') },
      {
        find: /^@ioai\/lerobot-studio-platform$/,
        replacement: path.resolve(__dirname, '../platform/src'),
      },
      { find: /^@ioai\/lerobot-studio-ui$/, replacement: path.resolve(__dirname, '../ui/src') },
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    legacy: {
      // react-intl's CJS interop otherwise emits runtime `require('react')`
      // in the ESM package build under Rolldown.
      inconsistentCjsInterop: true,
    },
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'lerobot.es',
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', /^use-sync-external-store(?:\/.*)?$/],
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'lerobot-studio.css';
          }
          return assetInfo.name || '[name][extname]';
        },
      },
    },
    cssCodeSplit: false,
  },
});
