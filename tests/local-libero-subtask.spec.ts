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
import { LocalFsDataSource } from './helpers/localFsDataSource';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';
import { readParquetToIPC } from './helpers/parquet';
import {
  DEFAULT_V3_SUBTASK_DATASET,
  isV3SubtaskSourceAvailable,
  materializeLiberoSubtaskSlim,
} from '../scripts/e2e/materializeLiberoSubtaskSlim';

const hasSource = isV3SubtaskSourceAvailable();

describe.skipIf(!hasSource)('local libero_10_subtask official export', () => {
  const loaders: LeRobotDataLoader[] = [];

  afterEach(async () => {
    await Promise.all(loaders.splice(0).map((loader) => loader.dispose()));
  });

  it('loads official libero_10_subtask with frame subtask_index and no subtasks.parquet', async () => {
    const loader = new LeRobotDataLoader(new LocalFsDataSource(DEFAULT_V3_SUBTASK_DATASET));
    loaders.push(loader);
    const info = await loader.initialize();
    expect(info.codebase_version).toBe('v3.0');
    expect(info.total_episodes).toBe(500);
    expect(info.features.subtask_index).toEqual({
      dtype: 'int64',
      shape: [1],
      names: null,
    });
    expect(existsSync(path.join(DEFAULT_V3_SUBTASK_DATASET, 'meta/subtasks.parquet'))).toBe(false);
    expect(Object.keys(loader.getTasks()).length).toBe(10);
    expect(loader.getTasks()[0]).toMatch(/stove/i);

    const source = await loader.loadEpisodeSubtaskSource(0);
    const unique = [
      ...new Set(source.indices.filter((index): index is number => index != null)),
    ].sort((left, right) => left - right);
    expect(unique).toEqual([4, 15]);
    expect(source.table[4]).toBe('Subtask 4');
    expect(source.table[15]).toBe('Subtask 15');
    expect(source.indices.some((index) => index === -1)).toBe(false);
  });

  it('materializes a slim v3 slice, views subtask_index, and exports official files', async () => {
    expect(
      existsSync(path.join(DEFAULT_V3_SUBTASK_DATASET, 'data/chunk-000/file-000.parquet')),
    ).toBe(true);
    const root = await materializeLiberoSubtaskSlim();
    expect(root).toBeTruthy();

    const loader = new LeRobotDataLoader(new LocalFsDataSource(root!));
    loaders.push(loader);
    const info = await loader.initialize();
    expect(info.codebase_version).toBe('v3.0');
    expect(info.features.subtask_index).toMatchObject({ dtype: 'int64', shape: [1] });
    expect(Object.keys(loader.getSubtasks()).length).toBeGreaterThan(0);

    const source = await loader.loadEpisodeSubtaskSource(0);
    expect(source.indices.some((index) => index != null)).toBe(true);
    expect(source.table[source.indices.find((index) => index != null)!]).toMatch(/^Subtask /);

    const adapter = new InMemoryExportAdapter();
    const service = new ExportService(loader, adapter);
    await service.exportWithData(info, loader.getEpisodes(), loader.getTasks(), {
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
    ) as { features: Record<string, { dtype: string; shape: number[] }> };
    expect(exportedInfo.features.subtask_index).toEqual({
      dtype: 'int64',
      shape: [1],
      names: null,
    });

    const tasksIpc = await readParquetToIPC(await adapter.readFile('meta/subtasks.parquet'));
    const tasksTable = tableFromIPC(tasksIpc);
    expect(tasksTable.schema.metadata.get('pandas')).toContain('"index_columns":["subtask"]');
    const dataFile = files.find((file) => file.startsWith('data/') && file.endsWith('.parquet'));
    expect(dataFile).toBeTruthy();
    const dataIpc = await readParquetToIPC(await adapter.readFile(dataFile!));
    const dataTable = tableFromIPC(dataIpc);
    const column = dataTable.getChild('subtask_index');
    expect(column).toBeTruthy();
    for (let row = 0; row < dataTable.numRows; row++) {
      const value = Number(column!.get(row));
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
