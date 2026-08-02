import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableFromIPC } from 'apache-arrow';
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

import { writeMetadata } from '@/platform';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import { readParquetToIPC } from './helpers/parquet';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';

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
    for (const name of [
      'episode_index',
      'length',
      'task_index',
      'dataset_from_index',
      'dataset_to_index',
    ]) {
      const field = table.schema.fields.find((candidate) => candidate.name === name);
      expect(field?.type.toString()).toBe('Int64');
    }
    expect(table.schema.fields.find((field) => field.name === 'tasks')?.type.toString()).toBe(
      'List<Utf8>',
    );
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
});
