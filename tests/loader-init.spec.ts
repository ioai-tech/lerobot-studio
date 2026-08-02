import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../packages/platform/src/workers/workerManager.ts', async () => {
  const { readParquetToIPC, readNumericColumns, readFeatureData } =
    await import('./helpers/parquet');

  return {
    createParquetWorker: () => ({
      readParquet: async (buffer: ArrayBuffer, columns?: string[]) => {
        return readParquetToIPC(new Uint8Array(buffer), columns);
      },
      readNumericColumns: async (
        buffer: ArrayBuffer,
        columns: string[],
        startRow: number,
        endRow: number,
      ) => {
        return readNumericColumns(new Uint8Array(buffer), columns, startRow, endRow);
      },
      readFeatureData: async (
        buffer: ArrayBuffer,
        columns: string[],
        startRow: number,
        endRow: number,
      ) => {
        return readFeatureData(new Uint8Array(buffer), columns, startRow, endRow);
      },
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import { getEagerEpisodeColumns } from '@ioai/lerobot-studio-core';
import { LeRobotDataLoader } from '@ioai/lerobot-studio-platform';
import type { ProgressHandler } from '@ioai/lerobot-studio-platform';
import { LocalFsDataSource } from './helpers/localFsDataSource';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testFileDir, '..');

class TrackingLocalFsDataSource extends LocalFsDataSource {
  public readonly textReads: string[] = [];
  public readonly byteReads: string[] = [];
  public readonly existsChecks: string[] = [];

  override async readText(relativePath: string, _onProgress?: ProgressHandler) {
    this.textReads.push(relativePath);
    return super.readText(relativePath, _onProgress);
  }

  override async readBytes(relativePath: string, _onProgress?: ProgressHandler) {
    this.byteReads.push(relativePath);
    return super.readBytes(relativePath, _onProgress);
  }

  override async exists(relativePath: string) {
    this.existsChecks.push(relativePath);
    return super.exists(relativePath);
  }
}

async function listExampleDatasets(): Promise<Array<{ name: string; dir: string }>> {
  const examplesDir = path.resolve(repoRoot, 'tests/fixtures/datasets');
  const entries = await fs.readdir(examplesDir, { withFileTypes: true });
  const datasets: Array<{ name: string; dir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.resolve(examplesDir, entry.name);
    await fs.access(path.join(dir, 'meta', 'info.json'));
    datasets.push({ name: entry.name, dir });
  }

  return datasets.sort((left, right) => left.name.localeCompare(right.name));
}

describe('LeRobotDataLoader initialization smoke', () => {
  it('initializes every dataset under tests/fixtures/datasets/ without eager data parquet reads for v2', async () => {
    const datasets = await listExampleDatasets();

    for (const { name, dir } of datasets) {
      const source = new TrackingLocalFsDataSource(dir);
      const loader = new LeRobotDataLoader(source);

      try {
        const info = await loader.initialize();
        expect(info.codebase_version, name).toBeTruthy();

        const eagerDataReads = source.byteReads.filter(
          (relativePath) => relativePath.startsWith('data/') || relativePath.startsWith('videos/'),
        );

        if (info.codebase_version.startsWith('v2')) {
          expect(eagerDataReads, `${name} should stay metadata-only during initialize`).toEqual([]);
        }
      } finally {
        await loader.dispose();
      }
    }
  });

  it('reuses the eager numeric parquet parse for same-file feature reads', async () => {
    const datasetDir = path.resolve(repoRoot, 'tests/fixtures/datasets/lerobotv2');
    const source = new TrackingLocalFsDataSource(datasetDir);
    const loader = new LeRobotDataLoader(source);

    try {
      const info = await loader.initialize();
      const eagerColumns = getEagerEpisodeColumns(info);
      const targetFeature = eagerColumns.find((column) => column !== 'timestamp');

      expect(targetFeature).toBeTruthy();

      await loader.loadAllNumericalData(0, eagerColumns);
      const episodePath = loader.getEpisodeDataPath(0)?.path;
      expect(episodePath).toBeTruthy();

      const readsAfterEagerLoad = source.byteReads.filter(
        (relativePath) => relativePath === episodePath,
      ).length;
      expect(readsAfterEagerLoad).toBe(1);

      await loader.loadFeatureData(0, [targetFeature!]);

      const readsAfterFeatureLoad = source.byteReads.filter(
        (relativePath) => relativePath === episodePath,
      ).length;
      expect(readsAfterFeatureLoad).toBe(1);
    } finally {
      await loader.dispose();
    }
  });
});
