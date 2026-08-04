import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { cssScopePlugin } from './scripts/vite/cssScopePlugin.ts';

const parquetWasmModule = path.resolve(
  import.meta.dirname,
  './node_modules/parquet-wasm/esm/parquet_wasm.js',
);

function explicitParquetWasmPlugin(): Plugin {
  return {
    name: 'explicit-parquet-wasm',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const cleanId = id.split('?', 1)[0];
      if (cleanId === parquetWasmModule) {
        const fallback = "module_or_path = new URL('parquet_wasm_bg.wasm', import.meta.url);";
        if (!code.includes(fallback)) {
          this.error('Could not remove parquet-wasm implicit WASM URL fallback.');
        }
        return {
          code: code.replace(
            fallback,
            `throw new Error('This build requires an explicit parquet-wasm module_or_path.');`,
          ),
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig({
  // Keep emitted Worker and lazy chunk references relative to the importing chunk.
  // Consumers may deploy at any origin root or sub-path.
  base: './',
  publicDir: false,
  plugins: [
    explicitParquetWasmPlugin(),
    react(),
    tailwindcss(),
    cssScopePlugin({ rootClass: 'lerobot-root' }),
  ],
  resolve: {
    alias: [
      {
        find: '@/workers/workerManager',
        replacement: path.resolve(import.meta.dirname, './src/platform/workers/workerManager.ts'),
      },
      {
        find: 'react-i18next',
        replacement: path.resolve(import.meta.dirname, './src/react/i18n/reactI18nextCompat.ts'),
      },
      { find: /^@\/core(?:\/|$)/, replacement: path.resolve(import.meta.dirname, './src/core') },
      {
        find: /^@\/platform(?:\/|$)/,
        replacement: path.resolve(import.meta.dirname, './src/platform'),
      },
      { find: /^@\/ui(?:\/|$)/, replacement: path.resolve(import.meta.dirname, './src/ui') },
      { find: /^@$/, replacement: path.resolve(import.meta.dirname, './src/react/index.ts') },
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, './src/react') + '/' },
    ],
  },
  worker: {
    format: 'es',
    plugins: () => [explicitParquetWasmPlugin()],
  },
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
