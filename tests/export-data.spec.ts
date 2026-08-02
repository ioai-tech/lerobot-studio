import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableFromIPC } from 'apache-arrow';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/export/parquetWasmLoader.ts', async () => {
  const { getParquetWasmNode } = await import('./helpers/parquetWasmNode');
  return {
    getParquetWasm: () => getParquetWasmNode(),
  };
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

import { exportDataFiles, LeRobotDataLoader } from '@/platform';
import type { EpisodeMetadata } from '@/core';
import { readParquetToIPC } from './helpers/parquet';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';
import { LocalFsDataSource } from './helpers/localFsDataSource';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testFileDir, '..');

function exampleDir(name: string): string {
  return path.resolve(repoRoot, 'tests/fixtures/datasets', name);
}

async function readParquetColumn(
  adapter: InMemoryExportAdapter,
  filePath: string,
  column: string,
): Promise<number[]> {
  const bytes = await adapter.readFile(filePath);
  const ipc = await readParquetToIPC(bytes);
  const table = tableFromIPC(ipc);
  const vec = table.getChild(column);
  if (!vec) throw new Error(`column ${column} not in ${filePath}`);
  return Array.from(
    (vec as unknown as { toArray: () => ArrayLike<number | bigint> }).toArray(),
  ).map(Number);
}

describe('exportDataFiles (v2 -> v3)', () => {
  it('merges v2 per-episode parquet into v3 data/chunk-000/file-000.parquet with 0..N episode_index and contiguous global index', async () => {
    const source = new LocalFsDataSource(exampleDir('lerobotv2'));
    const loader = new LeRobotDataLoader(source);
    const info = await loader.initialize();
    const episodes = loader.getEpisodes();
    const filtered = episodes.slice(1).slice(0, 2);
    expect(filtered.length).toBeGreaterThan(0);

    const adapter = new InMemoryExportAdapter();
    await exportDataFiles(loader, info, filtered, 'v3.0', adapter);
    await loader.dispose();

    const outPath = 'data/chunk-000/file-000.parquet';
    expect(adapter.hasFile(outPath)).toBe(true);

    const epIdxValues = await readParquetColumn(adapter, outPath, 'episode_index');
    const uniqueEpIdx = Array.from(new Set(epIdxValues));
    uniqueEpIdx.sort((a, b) => a - b);
    expect(uniqueEpIdx).toEqual(filtered.map((_, i) => i));

    const indexValues = await readParquetColumn(adapter, outPath, 'index');
    for (let i = 0; i < indexValues.length; i++) {
      expect(indexValues[i]).toBe(i);
    }
  });
});

describe('exportDataFiles (v3 -> v2)', () => {
  let loader: LeRobotDataLoader;
  let info: Awaited<ReturnType<LeRobotDataLoader['initialize']>>;
  let episodes: EpisodeMetadata[];

  beforeAll(async () => {
    const source = new LocalFsDataSource(exampleDir('lerobotv3'));
    loader = new LeRobotDataLoader(source);
    info = await loader.initialize();
    episodes = loader.getEpisodes();
  });

  it('writes per-episode parquet with sequential episode_index 0..N even when source episodes were not contiguous', async () => {
    if (episodes.length < 2) return;
    const filtered = episodes.slice(0, 2);
    const adapter = new InMemoryExportAdapter();
    await exportDataFiles(loader, info, filtered, 'v2.1', adapter);

    const outPath0 = 'data/chunk-000/episode_000000.parquet';
    const outPath1 = 'data/chunk-000/episode_000001.parquet';
    expect(adapter.hasFile(outPath0)).toBe(true);
    expect(adapter.hasFile(outPath1)).toBe(true);

    const firstEp = await readParquetColumn(adapter, outPath0, 'episode_index');
    expect(Array.from(new Set(firstEp))).toEqual([0]);

    const secondEp = await readParquetColumn(adapter, outPath1, 'episode_index');
    expect(Array.from(new Set(secondEp))).toEqual([1]);
  });
});

describe('exportDataFiles (v3 -> v3 after filtering)', () => {
  it('rebuilds episode_index to 0..N and rewrites global index to 0..M after dropping episodes', async () => {
    const source = new LocalFsDataSource(exampleDir('lerobotv3'));
    const loader = new LeRobotDataLoader(source);
    const info = await loader.initialize();
    const episodes = loader.getEpisodes();
    if (episodes.length < 2) return;
    const filtered = episodes.slice(1, 3);
    const adapter = new InMemoryExportAdapter();
    await exportDataFiles(loader, info, filtered, 'v3.0', adapter);
    await loader.dispose();

    const outFiles = adapter.listFiles().filter((p) => p.startsWith('data/'));
    expect(outFiles.length).toBeGreaterThan(0);

    const epIdxAll: number[] = [];
    const indexAll: number[] = [];
    for (const p of outFiles) {
      epIdxAll.push(...(await readParquetColumn(adapter, p, 'episode_index')));
      indexAll.push(...(await readParquetColumn(adapter, p, 'index')));
    }
    const uniqueEpIdx = Array.from(new Set(epIdxAll));
    uniqueEpIdx.sort((a, b) => a - b);
    expect(uniqueEpIdx).toEqual(filtered.map((_, i) => i));

    indexAll.sort((a, b) => a - b);
    for (let i = 0; i < indexAll.length; i++) {
      expect(indexAll[i]).toBe(i);
    }
  });
});
