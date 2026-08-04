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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/core/{analysis,playback,versioning}/**/*.ts',
        'src/platform/datasource/**/*.ts',
        'src/platform/export/{DataProcessor,ExportService,MetadataExporter,TaskPlan,WebExportAdapter}.ts',
        'src/platform/services/LeRobotDataLoader.ts',
      ],
      exclude: [
        // Type declarations and re-export barrels contain no runtime behavior.
        'src/**/types.ts',
        'src/**/index.ts',
        // Generated shadcn/UI primitives are thin third-party wrappers, not core logic.
        'src/react/components/ui/**',
        'src/ui/**',
        // Static UI catalog; behavior is exercised through source-controller tests.
        'src/platform/datasource/sampleDatasets.ts',
        // Browser-only worker/WASM entry points are covered by browser integration tests.
        'src/platform/workers/**',
        'src/platform/export/parquetWasmLoader.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
        'src/core/versioning/{LeRobotVersionAdapter,versionCapability,versionRegistry}.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        'src/platform/export/ExportService.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
