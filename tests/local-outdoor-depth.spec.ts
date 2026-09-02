import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tableFromIPC } from 'apache-arrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { LeRobotDataLoader } from '@/platform';
import {
  decodeUncompressedGrayscaleTiff,
  isDepthMapFeature,
  renderTiffDepthPreview,
  sniffImageFormat,
} from '@/core';
import { LocalFsDataSource } from './helpers/localFsDataSource';
import { readParquetToIPC } from './helpers/parquet';

export const DEFAULT_OUTDOOR_DEPTH_DATASET = '/data/lerobot/outdoor-depth';

export function isOutdoorDepthSourceAvailable(
  root = process.env.LEROBOT_DEPTH_DATASET?.trim() || DEFAULT_OUTDOOR_DEPTH_DATASET,
): boolean {
  return (
    existsSync(path.join(root, 'meta/info.json')) &&
    existsSync(path.join(root, 'data/chunk-000/file-000.parquet'))
  );
}

const hasSource = isOutdoorDepthSourceAvailable();

describe.skipIf(!hasSource)('local outdoor-depth official v3.0', () => {
  const loaders: LeRobotDataLoader[] = [];

  afterEach(async () => {
    await Promise.all(loaders.splice(0).map((loader) => loader.dispose()));
  });

  it('loads depth image metadata without subtasks', async () => {
    const loader = new LeRobotDataLoader(new LocalFsDataSource(DEFAULT_OUTDOOR_DEPTH_DATASET));
    loaders.push(loader);
    const info = await loader.initialize();
    expect(info.codebase_version).toBe('v3.0');
    expect(info.total_episodes).toBe(1);
    expect(info.total_frames).toBe(181);
    expect(info.features['observation.images.depth']).toMatchObject({
      dtype: 'image',
      shape: [720, 1280, 1],
    });
    expect(isDepthMapFeature(info.features['observation.images.depth'])).toBe(true);
    expect(info.features['observation.images.depth']?.info).toMatchObject({
      is_depth_map: true,
      depth_unit: 'mm',
    });
    expect(info.features.subtask_index).toBeUndefined();
    expect(Object.keys(loader.getSubtasks())).toHaveLength(0);
    expect(loader.getEpisodes()[0]?.length).toBe(181);
  });

  it('decodes official 16-bit depth TIFF frames for playback', async () => {
    const parquet = await fs.readFile(
      path.join(DEFAULT_OUTDOOR_DEPTH_DATASET, 'data/chunk-000/file-000.parquet'),
    );
    const table = tableFromIPC(await readParquetToIPC(parquet, ['observation.images.depth']));
    const row = table.getChild('observation.images.depth')?.get(0) as { bytes?: Uint8Array };
    const bytes = row?.bytes;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(sniffImageFormat(bytes!)).toBe('tiff');
    const decoded = decodeUncompressedGrayscaleTiff(bytes!);
    expect(decoded.width).toBe(1280);
    expect(decoded.height).toBe(720);
    expect(decoded.bitsPerSample).toBe(16);
    expect(decoded.pixels.some((value) => value > 0)).toBe(true);
    const preview = renderTiffDepthPreview(bytes!);
    expect(preview.rgba.length).toBe(1280 * 720 * 4);
    expect(preview.rgba.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true);
  });
});
