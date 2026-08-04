import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

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

import { writeMetadata } from '../src/platform/export/MetadataExporter';
import { V3Adapter } from '../src/core/versioning/v3Adapter';
import type { DataSource } from '../src/core/datasource/types';
import type { LeRobotInfo, EpisodeMetadata } from '../src/core/types/lerobot';
import type { MetadataLoadingHelpers } from '../src/core/versioning/types';
import { readParquetToIPC } from './helpers/parquet';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';

const { tableFromIPC } = arrow;

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testFileDir, '..');

function loadExampleInfo(name: string): LeRobotInfo {
  const p = path.resolve(repoRoot, 'tests/fixtures/datasets', name, 'meta', 'info.json');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw) as LeRobotInfo;
}

describe('writeMetadata - v2.1 target', () => {
  it('writes meta/info.json with 0..N-based episode metadata (episodes.jsonl reindexed)', async () => {
    const info = loadExampleInfo('lerobotv2');
    const adapter = new InMemoryExportAdapter();
    const episodes: EpisodeMetadata[] = [
      { episode_index: 42, length: 10, tasks: ['grab'], task_index: 0 },
      { episode_index: 99, length: 20, tasks: ['release'], task_index: 1 },
    ];
    const tasks = { 0: 'grab', 1: 'release' };

    await writeMetadata(info, episodes, tasks, 'v2.1', adapter);

    const infoBytes = await adapter.readFile('meta/info.json');
    const infoText = new TextDecoder().decode(infoBytes);
    const written = JSON.parse(infoText) as LeRobotInfo;
    expect(written.codebase_version).toBe('v2.1');
    expect(written.total_episodes).toBe(2);

    const jsonlBytes = await adapter.readFile('meta/episodes.jsonl');
    const jsonlLines = new TextDecoder()
      .decode(jsonlBytes)
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(jsonlLines).toHaveLength(2);
    const parsed = jsonlLines.map((line) => JSON.parse(line) as EpisodeMetadata);
    expect(parsed.map((ep) => ep.episode_index)).toEqual([0, 1]);
    expect(parsed[0].length).toBe(10);
    expect(parsed[1].length).toBe(20);

    const tasksBytes = await adapter.readFile('meta/tasks.jsonl');
    const tasksText = new TextDecoder().decode(tasksBytes);
    const taskLines = tasksText.split('\n').filter((l) => l.trim() !== '');
    expect(taskLines).toHaveLength(2);
    expect(JSON.parse(taskLines[0])).toEqual({ task_index: 0, task: 'grab' });
    expect(JSON.parse(taskLines[1])).toEqual({ task_index: 1, task: 'release' });
  });
});

describe('writeMetadata - v3.0 target', () => {
  it('writes meta/episodes/chunk-000/file-000.parquet with contiguous episode_index 0..N and cumulative dataset offsets', async () => {
    const info = loadExampleInfo('lerobotv3');
    const adapter = new InMemoryExportAdapter();
    const episodes: EpisodeMetadata[] = [
      {
        episode_index: 12,
        length: 5,
        tasks: ['a'],
        task_index: 0,
        dataset_from_index: 100,
        dataset_to_index: 105,
      } as EpisodeMetadata,
      {
        episode_index: 50,
        length: 7,
        tasks: ['a'],
        task_index: 0,
        dataset_from_index: 900,
        dataset_to_index: 907,
      } as EpisodeMetadata,
      {
        episode_index: 55,
        length: 3,
        tasks: ['b'],
        task_index: 1,
        dataset_from_index: 1200,
        dataset_to_index: 1203,
      } as EpisodeMetadata,
    ];
    const tasks = { 0: 'a', 1: 'b' };

    await writeMetadata(info, episodes, tasks, 'v3.0', adapter);

    const parquetBytes = await adapter.readFile('meta/episodes/chunk-000/file-000.parquet');
    const ipc = await readParquetToIPC(parquetBytes);
    const table = tableFromIPC(ipc);

    const epIdx = (
      table.getChild('episode_index') as unknown as { toArray: () => ArrayLike<number | bigint> }
    ).toArray();
    const lens = (
      table.getChild('length') as unknown as { toArray: () => ArrayLike<number | bigint> }
    ).toArray();
    const fromIdx = (
      table.getChild('dataset_from_index') as unknown as {
        toArray: () => ArrayLike<number | bigint>;
      }
    ).toArray();
    const toIdx = (
      table.getChild('dataset_to_index') as unknown as { toArray: () => ArrayLike<number | bigint> }
    ).toArray();

    expect(Array.from(epIdx).map(Number)).toEqual([0, 1, 2]);
    expect(Array.from(lens).map(Number)).toEqual([5, 7, 3]);
    // dataset_from/to_index must be cumulative 0..sum, NOT the source global indices.
    expect(Array.from(fromIdx).map(Number)).toEqual([0, 5, 12]);
    expect(Array.from(toIdx).map(Number)).toEqual([5, 12, 15]);
    for (const name of ['episode_index', 'length', 'dataset_from_index', 'dataset_to_index']) {
      const field = table.schema.fields.find((candidate) => candidate.name === name);
      expect(field?.type.toString()).toBe('Int64');
    }
    expect(table.schema.fields.find((field) => field.name === 'tasks')?.type.toString()).toBe(
      'List<Utf8>',
    );
    expect(table.getChild('task_index')).toBeNull();
    expect(Array.from(table.getChild('tasks')!.get(0) as Iterable<string>)).toEqual(['a']);
    expect(Array.from(table.getChild('tasks')!.get(2) as Iterable<string>)).toEqual(['b']);

    const tasksIpc = await readParquetToIPC(await adapter.readFile('meta/tasks.parquet'));
    const tasksTable = tableFromIPC(tasksIpc);
    expect(
      tasksTable.schema.fields.find((field) => field.name === 'task_index')?.type.toString(),
    ).toBe('Int64');
    expect(Array.from(tasksTable.getChild('task_index')!.toArray()).map(Number)).toEqual([0, 1]);
    expect(Array.from(tasksTable.getChild('task')!.toArray()).map(String)).toEqual(['a', 'b']);
  });

  it('writes actual rolled data references and official v3 size defaults', async () => {
    const info = {
      ...loadExampleInfo('lerobotv3'),
      chunks_size: 1,
      data_files_size_in_mb: undefined,
      video_files_size_in_mb: undefined,
    };
    const adapter = new InMemoryExportAdapter();
    const episodes = [
      { episode_index: 12, length: 2, tasks: ['a'], task_index: 0 },
      { episode_index: 50, length: 3, tasks: ['a'], task_index: 0 },
    ] as EpisodeMetadata[];
    const dataLayout = {
      episodes: new Map([
        [
          12,
          {
            chunk_index: 0,
            file_index: 0,
            dataset_from_index: 0,
            dataset_to_index: 2,
          },
        ],
        [
          50,
          {
            chunk_index: 1,
            file_index: 0,
            dataset_from_index: 2,
            dataset_to_index: 5,
          },
        ],
      ]),
      total_chunks: 2,
      total_files: 2,
    };

    await writeMetadata(
      info,
      episodes,
      { 0: 'a' },
      'v3.0',
      adapter,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      dataLayout,
    );

    const writtenInfo = JSON.parse(
      new TextDecoder().decode(await adapter.readFile('meta/info.json')),
    ) as LeRobotInfo;
    expect(writtenInfo).toMatchObject({
      chunks_size: 1,
      data_files_size_in_mb: 100,
      video_files_size_in_mb: 200,
    });
    expect(writtenInfo).not.toHaveProperty('total_chunks');
    expect(writtenInfo).not.toHaveProperty('total_files');

    const ipc = await readParquetToIPC(
      await adapter.readFile('meta/episodes/chunk-000/file-000.parquet'),
    );
    const table = tableFromIPC(ipc);
    expect(Array.from(table.getChild('data/chunk_index')!.toArray()).map(Number)).toEqual([0, 1]);
    expect(Array.from(table.getChild('data/file_index')!.toArray()).map(Number)).toEqual([0, 0]);
    expect(Array.from(table.getChild('dataset_from_index')!.toArray()).map(Number)).toEqual([0, 2]);
    expect(Array.from(table.getChild('dataset_to_index')!.toArray()).map(Number)).toEqual([2, 5]);
  });

  it('roundtrips extension columns and episode stats loaded from multiple metadata shards', async () => {
    const info = loadExampleInfo('lerobotv3');
    const makeShard = (
      episodeIndex: number,
      metadataFileIndex: number,
      label: string,
      scores: number[],
      mean: number[],
    ) =>
      new arrow.Table({
        episode_index: arrow.vectorFromArray([BigInt(episodeIndex)], new arrow.Int64()),
        length: arrow.vectorFromArray([2n], new arrow.Int64()),
        tasks: arrow.vectorFromArray(
          [['pick']],
          new arrow.List(new arrow.Field('item', new arrow.Utf8(), true)),
        ),
        dataset_from_index: arrow.vectorFromArray([BigInt(episodeIndex * 2)], new arrow.Int64()),
        dataset_to_index: arrow.vectorFromArray([BigInt(episodeIndex * 2 + 2)], new arrow.Int64()),
        'meta/episodes/chunk_index': arrow.vectorFromArray([0n], new arrow.Int64()),
        'meta/episodes/file_index': arrow.vectorFromArray(
          [BigInt(metadataFileIndex)],
          new arrow.Int64(),
        ),
        'data/chunk_index': arrow.vectorFromArray([0n], new arrow.Int64()),
        'data/file_index': arrow.vectorFromArray([0n], new arrow.Int64()),
        custom_label: arrow.vectorFromArray([label]),
        custom_scores: arrow.vectorFromArray(
          [scores],
          new arrow.List(new arrow.Field('item', new arrow.Float64(), true)),
        ),
        'stats/action/mean': arrow.vectorFromArray(
          [mean],
          new arrow.List(new arrow.Field('item', new arrow.Float64(), true)),
        ),
      });
    const shards = new Map([
      [
        'meta/episodes/chunk-000/file-000.parquet',
        arrow.tableToIPC(makeShard(0, 0, 'alpha', [1, 2], [0.25, 0.5]), 'stream'),
      ],
      [
        'meta/episodes/chunk-000/file-001.parquet',
        arrow.tableToIPC(makeShard(1, 1, 'beta', [3, 4], [0.75, 1]), 'stream'),
      ],
    ]);
    const requestedColumns: Array<string[] | undefined> = [];
    const dataSource: DataSource = {
      exists: async () => true,
      readText: async () => '{"task_index":0,"task":"pick"}',
      readBytes: async () => new Uint8Array(),
      getObjectUrl: async () => '',
      clear: () => undefined,
      listPaths: async () => Array.from(shards.keys()),
    };
    const helpers: MetadataLoadingHelpers = {
      readParquetToIPC: async (datasetPath, columns) => {
        if (datasetPath === 'meta/tasks.parquet') throw new Error('use tasks.jsonl');
        requestedColumns.push(columns);
        const ipc = shards.get(datasetPath);
        if (!ipc) throw new Error(`missing shard ${datasetPath}`);
        return ipc;
      },
    };

    const episodes = await new V3Adapter().loadEpisodes(dataSource, helpers, info);
    expect(requestedColumns).toEqual([undefined, undefined]);
    expect(episodes.map((episode) => episode.custom_label)).toEqual(['alpha', 'beta']);
    expect(episodes.map((episode) => episode.custom_scores)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(episodes.map((episode) => episode['stats/action/mean'])).toEqual([
      [0.25, 0.5],
      [0.75, 1],
    ]);

    const exportAdapter = new InMemoryExportAdapter();
    await writeMetadata(info, episodes, { 0: 'pick' }, 'v3.0', exportAdapter);
    const ipc = await readParquetToIPC(
      await exportAdapter.readFile('meta/episodes/chunk-000/file-000.parquet'),
    );
    const table = tableFromIPC(ipc);
    const listValues = (column: string) =>
      Array.from({ length: table.numRows }, (_, index) =>
        Array.from(table.getChild(column)!.get(index) as Iterable<number>).map(Number),
      );

    expect(Array.from(table.getChild('custom_label')!.toArray()).map(String)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(listValues('custom_scores')).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(listValues('stats/action/mean')).toEqual([
      [0.25, 0.5],
      [0.75, 1],
    ]);
    expect(Array.from(table.getChild('meta/episodes/chunk_index')!.toArray()).map(Number)).toEqual([
      0, 0,
    ]);
    expect(Array.from(table.getChild('meta/episodes/file_index')!.toArray()).map(Number)).toEqual([
      0, 0,
    ]);
    expect(table.getChild('chunk_index')).toBeNull();
    expect(table.getChild('file_index')).toBeNull();
  });

  it('rejects unsupported extension metadata instead of dropping it', async () => {
    const info = loadExampleInfo('lerobotv3');
    const adapter = new InMemoryExportAdapter();
    const episodes = [
      {
        episode_index: 0,
        length: 1,
        tasks: ['a'],
        dataset_from_index: 0,
        dataset_to_index: 1,
        unsafe_extension: { nested: true },
      },
    ] as EpisodeMetadata[];

    await expect(writeMetadata(info, episodes, { 0: 'a' }, 'v3.0', adapter)).rejects.toThrow(
      /unsafe_extension.*unsupported value type/i,
    );
    expect(adapter.hasFile('meta/info.json')).toBe(false);
  });

  it('embeds splits when supplied for v3 target', async () => {
    const info = loadExampleInfo('lerobotv3');
    const adapter = new InMemoryExportAdapter();
    const episodes: EpisodeMetadata[] = [
      {
        episode_index: 0,
        length: 2,
        tasks: ['a'],
        task_index: 0,
        dataset_from_index: 0,
        dataset_to_index: 2,
      } as EpisodeMetadata,
    ];
    await writeMetadata(
      info,
      episodes,
      { 0: 'a' },
      'v3.0',
      adapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { train: '0:1' },
    );
    const txt = new TextDecoder().decode(await adapter.readFile('meta/info.json'));
    const parsed = JSON.parse(txt) as LeRobotInfo & { splits?: Record<string, string> };
    expect(parsed.splits).toEqual({ train: '0:1' });
  });

  it('rejects non-official comma-separated v3 split metadata', async () => {
    const info = loadExampleInfo('lerobotv3');
    const adapter = new InMemoryExportAdapter();
    const episodes = [
      {
        episode_index: 0,
        length: 1,
        tasks: ['a'],
        dataset_from_index: 0,
        dataset_to_index: 1,
      },
      {
        episode_index: 1,
        length: 1,
        tasks: ['a'],
        dataset_from_index: 1,
        dataset_to_index: 2,
      },
    ] as EpisodeMetadata[];

    await expect(
      writeMetadata(
        info,
        episodes,
        { 0: 'a' },
        'v3.0',
        adapter,
        undefined,
        undefined,
        undefined,
        undefined,
        { train: '0,1' },
      ),
    ).rejects.toThrow(/split "train".*continuous start:end.*0,1/i);
    expect(adapter.hasFile('meta/info.json')).toBe(false);
  });
});
