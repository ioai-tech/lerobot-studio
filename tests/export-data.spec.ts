import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableFromArrays, tableFromIPC } from 'apache-arrow';
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

  it('rewrites frame task_index through the exported canonical task table', async () => {
    const table = tableFromArrays({
      episode_index: [5, 5],
      index: [100, 101],
      task_index: [7, 7],
    });
    const loader = {
      getEpisodeTableForExport: async () => ({ table, pathHint: 'source.parquet' }),
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v2.1',
      chunks_size: 1000,
      features: {},
    } as unknown as Awaited<ReturnType<LeRobotDataLoader['initialize']>>;
    const adapter = new InMemoryExportAdapter();

    await exportDataFiles(
      loader,
      info,
      [{ episode_index: 5, length: 2, tasks: ['pick'], task_index: 7 }],
      'v3.0',
      adapter,
      undefined,
      undefined,
      { tasks: { 7: 'pick' } },
    );

    expect(
      await readParquetColumn(adapter, 'data/chunk-000/file-000.parquet', 'task_index'),
    ).toEqual([0, 0]);
  });

  it('writes frame subtask_index from the export plan', async () => {
    const table = tableFromArrays({
      episode_index: [5, 5],
      index: [100, 101],
    });
    const loader = {
      getEpisodeTableForExport: async () => ({ table, pathHint: 'source.parquet' }),
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v3.0',
      chunks_size: 1000,
      features: {},
    } as unknown as Awaited<ReturnType<LeRobotDataLoader['initialize']>>;
    const adapter = new InMemoryExportAdapter();

    await exportDataFiles(
      loader,
      info,
      [{ episode_index: 5, length: 2, tasks: ['pick'], task_index: 0 }],
      'v3.0',
      adapter,
      undefined,
      undefined,
      {
        subtaskPlan: {
          table: { 0: 'Approach', 1: 'Grasp' },
          framesBySourceEpisode: new Map([[5, [0, 1]]]),
        },
      },
    );

    expect(
      await readParquetColumn(adapter, 'data/chunk-000/file-000.parquet', 'subtask_index'),
    ).toEqual([0, 1]);
  });

  it('uses an episode-local task mapping when only one of two same-task episodes is edited', async () => {
    const tables = new Map([
      [10, tableFromArrays({ episode_index: [10, 10], index: [0, 1], task_index: [0, 0] })],
      [11, tableFromArrays({ episode_index: [11, 11], index: [2, 3], task_index: [0, 0] })],
    ]);
    const loader = {
      getEpisodeTableForExport: async (episodeIndex: number) => ({
        table: tables.get(episodeIndex)!,
        pathHint: 'source.parquet',
      }),
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v2.1',
      chunks_size: 1000,
      features: {},
    } as unknown as Awaited<ReturnType<LeRobotDataLoader['initialize']>>;
    const adapter = new InMemoryExportAdapter();

    await exportDataFiles(
      loader,
      info,
      [
        { episode_index: 10, length: 2, tasks: ['pick'], task_index: 0 },
        { episode_index: 11, length: 2, tasks: ['place'], task_index: undefined },
      ],
      'v3.0',
      adapter,
      undefined,
      undefined,
      { tasks: { 0: 'pick' } },
    );

    expect(
      await readParquetColumn(adapter, 'data/chunk-000/file-000.parquet', 'task_index'),
    ).toEqual([0, 0, 1, 1]);
  });

  it('maps multi-task frames by source labels and rejects unknown mappings', async () => {
    const table = tableFromArrays({
      episode_index: [4, 4],
      index: [0, 1],
      task_index: [0, 1],
    });
    const loader = {
      getEpisodeTableForExport: async () => ({ table, pathHint: 'source.parquet' }),
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v2.1',
      chunks_size: 1000,
      features: {},
    } as unknown as Awaited<ReturnType<LeRobotDataLoader['initialize']>>;
    const episode = { episode_index: 4, length: 2, tasks: ['pick', 'place'] };
    const adapter = new InMemoryExportAdapter();

    await exportDataFiles(loader, info, [episode], 'v3.0', adapter, undefined, undefined, {
      tasks: { 0: 'pick', 1: 'place' },
    });
    expect(
      await readParquetColumn(adapter, 'data/chunk-000/file-000.parquet', 'task_index'),
    ).toEqual([0, 1]);

    await expect(
      exportDataFiles(
        loader,
        info,
        [episode],
        'v3.0',
        new InMemoryExportAdapter(),
        undefined,
        undefined,
        { tasks: { 0: 'pick' } },
      ),
    ).rejects.toThrow(/Cannot map frame task_index 1/);
  });

  it('fails when actual episode rows differ from metadata length', async () => {
    const table = tableFromArrays({ episode_index: [0, 0], task_index: [0, 0] });
    const loader = {
      getEpisodeTableForExport: async () => ({ table, pathHint: 'source.parquet' }),
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v2.1',
      chunks_size: 1000,
      features: {},
    } as unknown as Awaited<ReturnType<LeRobotDataLoader['initialize']>>;

    await expect(
      exportDataFiles(
        loader,
        info,
        [{ episode_index: 0, length: 3, tasks: ['pick'], task_index: 0 }],
        'v3.0',
        new InMemoryExportAdapter(),
        undefined,
        undefined,
        { tasks: { 0: 'pick' } },
      ),
    ).rejects.toThrow(/row count 2 does not match metadata length 3/);
  });

  it('rolls data files by generated size and chunks by file count', async () => {
    const tables = new Map([
      [10, tableFromArrays({ episode_index: [10], index: [0], task_index: [0], value: [1] })],
      [20, tableFromArrays({ episode_index: [20], index: [1], task_index: [0], value: [2] })],
      [30, tableFromArrays({ episode_index: [30], index: [2], task_index: [0], value: [3] })],
    ]);
    const loader = {
      getEpisodeTableForExport: async (episodeIndex: number) => ({
        table: tables.get(episodeIndex)!,
        pathHint: 'source.parquet',
      }),
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v2.1',
      chunks_size: 2,
      data_files_size_in_mb: 0.000001,
      features: {},
    } as unknown as Awaited<ReturnType<LeRobotDataLoader['initialize']>>;
    const episodes = [10, 20, 30].map((episode_index) => ({
      episode_index,
      length: 1,
      tasks: ['pick'],
      task_index: 0,
    }));
    const adapter = new InMemoryExportAdapter();

    const layout = await exportDataFiles(
      loader,
      info,
      episodes,
      'v3.0',
      adapter,
      undefined,
      undefined,
      { tasks: { 0: 'pick' } },
    );

    expect(layout).toMatchObject({ total_files: 3, total_chunks: 2 });
    expect(
      adapter
        .listFiles()
        .filter((file) => file.startsWith('data/'))
        .sort(),
    ).toEqual([
      'data/chunk-000/file-000.parquet',
      'data/chunk-000/file-001.parquet',
      'data/chunk-001/file-000.parquet',
    ]);
    expect(layout?.episodes.get(10)).toEqual({
      chunk_index: 0,
      file_index: 0,
      dataset_from_index: 0,
      dataset_to_index: 1,
    });
    expect(layout?.episodes.get(20)).toEqual({
      chunk_index: 0,
      file_index: 1,
      dataset_from_index: 1,
      dataset_to_index: 2,
    });
    expect(layout?.episodes.get(30)).toEqual({
      chunk_index: 1,
      file_index: 0,
      dataset_from_index: 2,
      dataset_to_index: 3,
    });
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
    await exportDataFiles(loader, info, filtered, 'v2.1', adapter, undefined, undefined, {
      tasks: loader.getTasks(),
    });

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
    await exportDataFiles(loader, info, filtered, 'v3.0', adapter, undefined, undefined, {
      tasks: loader.getTasks(),
    });
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
