import { existsSync } from 'node:fs';
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
import { LeRobotDataLoader, ExportService } from '@/platform';
import { SubtaskCoverageError, assertExportCoverage, segmentsFromFrameIndices } from '@/core';
import { LocalFsDataSource } from './helpers/localFsDataSource';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';
import { readParquetToIPC } from './helpers/parquet';

export const DEFAULT_PUSHT_SUBTASK_DATASET = '/data/lerobot/pusht-subtask';

export function isPushtSubtaskSourceAvailable(
  root = process.env.LEROBOT_PUSHT_SUBTASK_DATASET?.trim() || DEFAULT_PUSHT_SUBTASK_DATASET,
): boolean {
  return (
    existsSync(path.join(root, 'meta/info.json')) &&
    existsSync(path.join(root, 'meta/subtasks.parquet')) &&
    existsSync(path.join(root, 'data/chunk-000/file-000.parquet'))
  );
}

const hasSource = isPushtSubtaskSourceAvailable();

describe.skipIf(!hasSource)('local pusht-subtask official v3.0', () => {
  const loaders: LeRobotDataLoader[] = [];

  afterEach(async () => {
    await Promise.all(loaders.splice(0).map((loader) => loader.dispose()));
  });

  it('loads official subtasks.parquet labels and treats -1 as unlabeled', async () => {
    const loader = new LeRobotDataLoader(new LocalFsDataSource(DEFAULT_PUSHT_SUBTASK_DATASET));
    loaders.push(loader);
    const info = await loader.initialize();
    expect(info.codebase_version).toBe('v3.0');
    expect(info.total_episodes).toBe(206);
    expect(info.features.subtask_index).toMatchObject({
      dtype: 'int64',
      shape: [1],
      names: null,
    });
    expect(info.features.task_index_high_level).toMatchObject({
      dtype: 'int64',
      shape: [1],
      names: null,
    });
    expect(loader.getTasks()[0]).toMatch(/Push the T-shaped block/i);
    expect(loader.getSubtasks()).toEqual({
      0: 'phase 1',
      1: 'phase 2',
      2: 'phase 3',
    });

    const unlabeled = await loader.loadEpisodeSubtaskSource(0);
    expect(unlabeled.indices.length).toBeGreaterThan(0);
    expect(unlabeled.indices.every((index) => index == null)).toBe(true);
    expect(unlabeled.table).toMatchObject({
      0: 'phase 1',
      1: 'phase 2',
      2: 'phase 3',
    });
    expect(() =>
      assertExportCoverage(
        0,
        unlabeled.indices.length,
        segmentsFromFrameIndices(unlabeled.indices, unlabeled.table),
      ),
    ).toThrow(SubtaskCoverageError);

    const labeled = await loader.loadEpisodeSubtaskSource(1);
    const unique = [
      ...new Set(labeled.indices.filter((index): index is number => index != null)),
    ].sort((left, right) => left - right);
    expect(unique).toEqual([0, 1, 2]);
    expect(labeled.table[0]).toBe('phase 1');
    expect(labeled.table[1]).toBe('phase 2');
    expect(labeled.table[2]).toBe('phase 3');
    expect(labeled.indices.some((index) => index === -1)).toBe(false);
  });

  it('exports a fully labeled official episode without writing -1', async () => {
    const loader = new LeRobotDataLoader(new LocalFsDataSource(DEFAULT_PUSHT_SUBTASK_DATASET));
    loaders.push(loader);
    const info = await loader.initialize();
    const episode = loader.getEpisodes().find((item) => item.episode_index === 1);
    expect(episode).toBeTruthy();

    const adapter = new InMemoryExportAdapter();
    await new ExportService(loader, adapter).exportWithData(info, [episode!], loader.getTasks(), {
      format: 'zip',
      targetVersion: 'v3.0',
      includeData: true,
      includeVideos: false,
      sourceSubtasks: loader.getSubtasks(),
    });

    const files = adapter.listFiles();
    expect(files).toContain('meta/subtasks.parquet');
    expect(files).toContain('meta/info.json');
    const exportedInfo = JSON.parse(
      new TextDecoder().decode(await adapter.readFile('meta/info.json')),
    ) as { features: Record<string, { dtype?: string; shape?: number[]; names?: null }> };
    expect(exportedInfo.features.subtask_index).toEqual({
      dtype: 'int64',
      shape: [1],
      names: null,
    });
    expect(exportedInfo.features.task_index_high_level).toMatchObject({
      dtype: 'int64',
      shape: [1],
    });

    const subtasksIpc = await readParquetToIPC(await adapter.readFile('meta/subtasks.parquet'));
    const subtasksTable = tableFromIPC(subtasksIpc);
    expect(subtasksTable.schema.metadata.get('pandas')).toContain('"index_columns":["subtask"]');
    const labels = new Map<number, string>();
    const indexVector = subtasksTable.getChild('subtask_index');
    const labelVector = subtasksTable.getChild('subtask');
    for (let row = 0; row < subtasksTable.numRows; row++) {
      labels.set(Number(indexVector?.get(row)), String(labelVector?.get(row)));
    }
    expect(Object.fromEntries(labels)).toMatchObject({
      0: 'phase 1',
      1: 'phase 2',
      2: 'phase 3',
    });

    const dataFile = files.find((file) => file.startsWith('data/') && file.endsWith('.parquet'));
    expect(dataFile).toBeTruthy();
    const dataTable = tableFromIPC(await readParquetToIPC(await adapter.readFile(dataFile!)));
    expect(dataTable.schema.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'subtask_index',
        'task_index',
        'task_index_high_level',
        'next.reward',
        'next.done',
        'next.success',
      ]),
    );
    const column = dataTable.getChild('subtask_index');
    const highLevel = dataTable.getChild('task_index_high_level');
    expect(column).toBeTruthy();
    const unique = new Set<number>();
    for (let row = 0; row < dataTable.numRows; row++) {
      const value = Number(column!.get(row));
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      unique.add(value);
      expect(Number(highLevel?.get(row))).toBe(-1);
    }
    expect([...unique].sort((left, right) => left - right)).toEqual([0, 1, 2]);
  });
});
