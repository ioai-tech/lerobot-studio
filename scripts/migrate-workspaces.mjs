#!/usr/bin/env node
/**
 * One-shot workspace migration: move src/ into packages/* + apps/web.
 * Run from repo root. Safe to re-run only on a clean tree before first commit.
 */
import {
  mkdirSync,
  renameSync,
  cpSync,
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';

const ROOT = process.cwd();

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function move(from, to) {
  const src = join(ROOT, from);
  const dest = join(ROOT, to);
  if (!existsSync(src)) {
    console.warn('skip missing', from);
    return;
  }
  ensureDir(dirname(dest));
  if (existsSync(dest)) {
    console.warn('dest exists, skip', to);
    return;
  }
  renameSync(src, dest);
  console.log('mv', from, '->', to);
}

function copyDir(from, to) {
  const src = join(ROOT, from);
  const dest = join(ROOT, to);
  if (!existsSync(src)) return;
  ensureDir(dest);
  cpSync(src, dest, { recursive: true });
  console.log('cp', from, '->', to);
}

// --- Move core ---
move('src/types/lerobot.ts', 'packages/core/src/types/lerobot.ts');
move('src/contexts/episodeLoadPlan.ts', 'packages/core/src/playback/episodeLoadPlan.ts');
move('src/services/versioning', 'packages/core/src/versioning');
move('src/services/analysis/SplitService.ts', 'packages/core/src/analysis/SplitService.ts');
move('src/services/analysis/StatsService.ts', 'packages/core/src/analysis/StatsService.ts');
move('src/services/export/types.ts', 'packages/core/src/export/types.ts');
move('src/services/export/ExportAdapter.ts', 'packages/core/src/export/ExportAdapter.ts');
move('src/services/export/MetadataExporter.ts', 'packages/core/src/export/MetadataExporter.ts');
move('src/utils/featureUtils.ts', 'packages/core/src/utils/featureUtils.ts');
move('src/utils/datasetDisplayName.ts', 'packages/core/src/utils/datasetDisplayName.ts');
move('src/utils/mediaFeatureMetadata.ts', 'packages/core/src/utils/mediaFeatureMetadata.ts');
move('src/lib/chartTooltipPlacement.ts', 'packages/core/src/utils/chartTooltipPlacement.ts');
move('src/workers/imageColumns.ts', 'packages/core/src/utils/imageColumns.ts');
move('src/workers/types.ts', 'packages/core/src/workers/types.ts');
move(
  'src/components/Playback/playbackAutoplay.ts',
  'packages/core/src/playback/playbackAutoplay.ts',
);
move('src/components/Sidebar/episodes/keyboard.ts', 'packages/core/src/utils/episodeKeyboard.ts');
move(
  'src/components/panels/Common/filters/selectionModel.ts',
  'packages/core/src/panels/selectionModel.ts',
);
move(
  'src/components/panels/Common/filters/filterGrouping.ts',
  'packages/core/src/panels/filterGrouping.ts',
);
move(
  'src/components/panels/ChartPanel/chartFeatureSelection.ts',
  'packages/core/src/panels/chartFeatureSelection.ts',
);
move(
  'src/components/panels/ChartPanel/chartFilterGrouping.ts',
  'packages/core/src/panels/chartFilterGrouping.ts',
);
move(
  'src/components/panels/ChartPanel/Split/splitChartConstants.ts',
  'packages/core/src/panels/splitChartConstants.ts',
);
move(
  'src/components/panels/ImagePanel/imagePanelLoadGuards.ts',
  'packages/core/src/panels/imagePanelLoadGuards.ts',
);
move(
  'src/components/panels/ImagePanel/imagePanelRequestUtils.ts',
  'packages/core/src/panels/imagePanelRequestUtils.ts',
);

// Extract DataSource interface file will be created; move browser implementations to platform
move('src/services/dataSources.ts', 'packages/platform/src/datasource/dataSources.ts');
move(
  'src/services/ArchiveDataSourceFactory.ts',
  'packages/platform/src/datasource/ArchiveDataSourceFactory.ts',
);
move(
  'src/services/RemoteManifestDataSource.ts',
  'packages/platform/src/datasource/RemoteManifestDataSource.ts',
);
move('src/services/remotePreflight.ts', 'packages/platform/src/datasource/remotePreflight.ts');
move('src/services/sampleDatasets.ts', 'packages/platform/src/datasource/sampleDatasets.ts');
move('src/services/LeRobotDataLoader.ts', 'packages/platform/src/services/LeRobotDataLoader.ts');
move(
  'src/services/ParquetImageService.ts',
  'packages/platform/src/services/ParquetImageService.ts',
);
move('src/services/platformDetector.ts', 'packages/platform/src/services/platformDetector.ts');
move('src/services/mediaCopy.ts', 'packages/platform/src/services/mediaCopy.ts');
move('src/services/export/ParquetWriter.ts', 'packages/platform/src/export/ParquetWriter.ts');
move(
  'src/services/export/parquetWasmLoader.ts',
  'packages/platform/src/export/parquetWasmLoader.ts',
);
move('src/services/export/WebExportAdapter.ts', 'packages/platform/src/export/WebExportAdapter.ts');
move(
  'src/services/export/ImageVideoExporter.ts',
  'packages/platform/src/export/ImageVideoExporter.ts',
);
move('src/services/export/VideoExporter.ts', 'packages/platform/src/export/VideoExporter.ts');
move('src/services/export/DataProcessor.ts', 'packages/platform/src/export/DataProcessor.ts');
move('src/services/export/ExportService.ts', 'packages/platform/src/export/ExportService.ts');
move('src/services/export/index.ts', 'packages/platform/src/export/index.ts');
move('src/workers/parquet.worker.ts', 'packages/platform/src/workers/parquet.worker.ts');
move('src/workers/parquetImage.worker.ts', 'packages/platform/src/workers/parquetImage.worker.ts');
move('src/workers/workerManager.ts', 'packages/platform/src/workers/workerManager.ts');
move('src/workers/wasmUrl.ts', 'packages/platform/src/workers/wasmUrl.ts');
move('src/workers/wasmUrl.inline.ts', 'packages/platform/src/workers/wasmUrl.inline.ts');
move('src/utils/MediaCache.ts', 'packages/platform/src/utils/MediaCache.ts');
move('src/utils/handleStore.ts', 'packages/platform/src/utils/handleStore.ts');
move('src/utils/fsPermissions.ts', 'packages/platform/src/utils/fsPermissions.ts');
move('src/utils/storage.ts', 'packages/platform/src/utils/storage.ts');

// UI
move('src/components/ui', 'packages/ui/src/components');
move('src/lib/utils.ts', 'packages/ui/src/utils.ts');
// toaster depends on ToastContext — move back to react later if needed
if (existsSync(join(ROOT, 'packages/ui/src/components/toaster.tsx'))) {
  ensureDir(join(ROOT, 'packages/react/src/components/ui'));
  move('packages/ui/src/components/toaster.tsx', 'packages/react/src/components/ui/toaster.tsx');
}

// Web app pieces
move('src/main.tsx', 'apps/web/src/main.tsx');
move('src/App.tsx', 'apps/web/src/App.tsx');
move('src/app', 'apps/web/src/app');
move('src/services/SourceController.ts', 'apps/web/src/services/SourceController.ts');
move(
  'src/hooks/useUrlDrivenSourceController.ts',
  'apps/web/src/hooks/useUrlDrivenSourceController.ts',
);
move('src/utils/sourceUrl.ts', 'apps/web/src/utils/sourceUrl.ts');
move('index.html', 'apps/web/index.html');
copyDir('public', 'apps/web/public');
move('scripts/generate-public-seo.mjs', 'apps/web/scripts/generate-public-seo.mjs');
move('scripts/generate-sample-manifest.mjs', 'apps/web/scripts/generate-sample-manifest.mjs');

// Remaining src → react package
move('src/index.ts', 'packages/react/src/index.ts');
move('src/index.css', 'packages/react/src/index.css');
move('src/vite-env.d.ts', 'packages/react/src/vite-env.d.ts');
move('src/components', 'packages/react/src/components');
move('src/contexts', 'packages/react/src/contexts');
move('src/hooks', 'packages/react/src/hooks');
move('src/i18n', 'packages/react/src/i18n');
move('src/locales', 'packages/react/src/locales');
move('src/lib', 'packages/react/src/lib');
// leftover utils
if (existsSync(join(ROOT, 'src/utils'))) {
  for (const name of readdirSync(join(ROOT, 'src/utils'))) {
    move(`src/utils/${name}`, `packages/react/src/utils/${name}`);
  }
}

// Cleanup empty dirs
for (const d of [
  'src/services/analysis',
  'src/services/export',
  'src/services',
  'src/workers',
  'src/types',
  'src/utils',
  'src/hooks',
  'src',
  'public',
  'scripts',
]) {
  const p = join(ROOT, d);
  if (existsSync(p) && readdirSync(p).length === 0) {
    rmSync(p, { recursive: true });
    console.log('rm empty', d);
  }
}

console.log('migration moves done');
