import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableFromIPC } from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/export/parquetWasmLoader.ts', async () => {
  const { getParquetWasmNode } = await import('./helpers/parquetWasmNode');
  return { getParquetWasm: () => getParquetWasmNode() };
});

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const { readParquetToIPC, readNumericColumns, readFeatureData } =
    await import('./helpers/parquet');
  return {
    createParquetWorker: () => ({
      readParquet: async (buffer: ArrayBuffer, columns?: string[]) =>
        readParquetToIPC(new Uint8Array(buffer), columns),
      readNumericColumns: async (
        buffer: ArrayBuffer,
        columns: string[],
        startRow: number,
        endRow: number,
      ) => readNumericColumns(new Uint8Array(buffer), columns, startRow, endRow),
      readFeatureData: async (
        buffer: ArrayBuffer,
        columns: string[],
        startRow: number,
        endRow: number,
      ) => readFeatureData(new Uint8Array(buffer), columns, startRow, endRow),
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import {
  exportImageFeaturesAsVideo,
  getImageFeatureKeys,
  rewriteFeaturesForImageToVideo,
} from '../src/platform/export/ImageVideoExporter.ts';
import { exportDataFiles } from '../src/platform/export/DataProcessor.ts';
import { LeRobotDataLoader } from '../src/platform/services/LeRobotDataLoader.ts';
import type { LeRobotInfo } from '@/core';
import { readParquetToIPC } from './helpers/parquet';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';
import { LocalFsDataSource } from './helpers/localFsDataSource';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testFileDir, '..');

describe('ImageVideoExporter helpers', () => {
  it('detects image dtype features correctly', () => {
    const info = {
      features: {
        'observation.images.a': { dtype: 'image', shape: [1], names: null },
        'observation.images.b': { dtype: 'video', shape: [1], names: null },
        'observation.state': { dtype: 'float32', shape: [1], names: null },
      },
    } as unknown as LeRobotInfo;
    expect(getImageFeatureKeys(info)).toEqual(['observation.images.a']);
  });

  it('rewrites info.features[key].dtype from image to video and fills fps/codec metadata', () => {
    const info = {
      fps: 30,
      features: {
        'observation.images.cam': {
          dtype: 'image',
          shape: [480, 640, 3],
          names: null,
        },
        'observation.state': { dtype: 'float32', shape: [2], names: null },
      },
    } as unknown as LeRobotInfo;
    const rewritten = rewriteFeaturesForImageToVideo(info, ['observation.images.cam']);
    expect(rewritten.features['observation.images.cam'].dtype).toBe('video');
    expect(rewritten.features['observation.images.cam'].fps).toBe(30);
    expect(rewritten.features['observation.images.cam'].info?.['video.codec']).toBe('h264');
    // Other features untouched
    expect(rewritten.features['observation.state'].dtype).toBe('float32');
  });

  it('fails atomically when an image feature has no encodable frames', async () => {
    const adapter = new InMemoryExportAdapter();
    const imageInfo = {
      fps: 30,
      features: {
        camera: { dtype: 'image', shape: [2, 2, 3], names: null },
      },
    } as unknown as LeRobotInfo;
    const loader = {
      loadFeatureData: vi.fn(async () => ({ camera: [] })),
    };

    await expect(
      exportImageFeaturesAsVideo(
        loader as any,
        imageInfo,
        [{ episode_index: 0, length: 1, tasks: [] }] as any,
        'v3.0',
        adapter,
      ),
    ).rejects.toThrow('Image→MP4 encoding failed');
    expect(adapter.hasFile('videos/camera/chunk-000/file-000.mp4')).toBe(false);
  });
});

describe('exportDataFiles strips image columns from exported parquet', () => {
  it('removes columns listed in excludeColumns but keeps numeric features', async () => {
    const datasetDir = path.resolve(repoRoot, 'tests/fixtures/datasets/lerobotv2');
    const source = new LocalFsDataSource(datasetDir);
    const loader = new LeRobotDataLoader(source);
    const info = await loader.initialize();
    const episodes = loader.getEpisodes();
    expect(episodes.length).toBeGreaterThan(0);

    // Synthetic fixtures have no image dtype; exercise excludeColumns with a numeric key.
    const excludeColumns = new Set(['action']);

    const adapter = new InMemoryExportAdapter();
    await exportDataFiles(
      loader,
      info,
      episodes.slice(0, 1),
      'v2.1',
      adapter,
      undefined,
      undefined,
      { excludeColumns },
    );
    await loader.dispose();

    const outPath = 'data/chunk-000/episode_000000.parquet';
    expect(adapter.hasFile(outPath)).toBe(true);
    const bytes = await adapter.readFile(outPath);
    const ipc = await readParquetToIPC(bytes);
    const table = tableFromIPC(ipc);
    const names = new Set(table.schema.fields.map((f) => f.name));
    expect(names.has('action')).toBe(false);
    expect(names.has('observation.state')).toBe(true);
    expect(names.has('episode_index')).toBe(true);
    expect(names.has('index')).toBe(true);
  });
});
