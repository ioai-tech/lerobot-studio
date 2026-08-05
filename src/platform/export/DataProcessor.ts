import * as arrow from 'apache-arrow';
import type { Table } from 'apache-arrow';
import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import { isV3Info, isV3Metadata } from '@/core';
import type { ExportAdapter } from '@/core';
import type { ExportProgress, V3DataLayout } from '@/core';
import { tableToParquetBytes } from './ParquetWriter';
import { buildExportTaskPlan, resolveExportTaskIndex, type ExportTaskPlan } from './TaskPlan';

const CHUNK_SIZE_DEFAULT = 1000;
const DATA_FILE_SIZE_MB_DEFAULT = 100;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Produce a new Arrow table where the `episode_index` column is replaced with
 * a constant vector of `newEpisodeIndex`, and the `index` (global frame index)
 * column is replaced with `globalStart..globalStart+n-1`.
 *
 * This guarantees the exported dataset is self-contained and matches the
 * rewritten `meta/episodes` 0..N indexing – essential after users delete or
 * reorder episodes.
 */
function toSafeInteger(value: unknown, field: string): number {
  if (value === null || value === undefined) {
    throw new Error(`${field} is null or missing`);
  }
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${field} is outside JavaScript's safe integer range: ${String(value)}`);
  }
  return number;
}

function rewriteEpisodeAndGlobalIndex(
  table: Table,
  newEpisodeIndex: number,
  globalStart: number,
  taskPlan: ExportTaskPlan,
): Table {
  const n = table.numRows;
  if (n === 0) return table;
  if (!Number.isSafeInteger(globalStart + n - 1)) {
    throw new RangeError('Exported frame index exceeds JavaScript safe integer range');
  }
  const episodeIndex = Array.from({ length: n }, () => BigInt(newEpisodeIndex));
  const index = Array.from({ length: n }, (_, i) => BigInt(globalStart + i));

  const overrides: Record<string, arrow.Vector> = {};
  if (table.schema.fields.some((f) => f.name === 'episode_index')) {
    overrides.episode_index = arrow.vectorFromArray(episodeIndex, new arrow.Int64());
  }
  if (table.schema.fields.some((f) => f.name === 'index')) {
    overrides.index = arrow.vectorFromArray(index, new arrow.Int64());
  }
  const sourceTaskIndex = table.getChild('task_index');
  if (sourceTaskIndex) {
    const rewritten = new Array<bigint>(n);
    for (let row = 0; row < n; row++) {
      const sourceIndex = toSafeInteger(sourceTaskIndex.get(row), 'task_index');
      const targetIndex = resolveExportTaskIndex(taskPlan, newEpisodeIndex, sourceIndex);
      if (targetIndex === undefined) {
        throw new Error(
          `Cannot map frame task_index ${sourceIndex} for exported episode ${newEpisodeIndex}`,
        );
      }
      rewritten[row] = BigInt(targetIndex);
    }
    overrides.task_index = arrow.vectorFromArray(rewritten, new arrow.Int64());
  }
  if (Object.keys(overrides).length === 0) return table;

  const overrideTable = new arrow.Table(overrides as never);
  return table.assign(overrideTable) as unknown as Table;
}

async function getValidatedEpisodeTable(
  dataLoader: LeRobotDataLoader,
  episode: EpisodeMetadata,
): Promise<Table> {
  const { table } = await dataLoader.getEpisodeTableForExport(episode.episode_index);
  if (!Number.isSafeInteger(episode.length) || episode.length < 0) {
    throw new Error(
      `Episode ${episode.episode_index} has invalid metadata length ${episode.length}`,
    );
  }
  if (table.numRows !== episode.length) {
    throw new Error(
      `Episode ${episode.episode_index} row count ${table.numRows} does not match metadata length ${episode.length}`,
    );
  }
  return table;
}

export interface ExportDataOptions {
  /** Columns to strip from the exported parquet files (e.g. image features replaced by video). */
  excludeColumns?: Set<string>;
  /** Source task mapping used to rewrite frame-level task_index values. */
  tasks?: Record<number, string>;
  /** Precomputed canonical plan shared with stats and metadata preparation. */
  taskPlan?: ExportTaskPlan;
}

/**
 * Exports data Parquet files: filter deleted, or convert v2<->v3.
 */
export async function exportDataFiles(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  targetVersion: 'v2.1' | 'v3.0' | undefined,
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options?: ExportDataOptions,
): Promise<V3DataLayout | undefined> {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const isTargetV3 = targetVersion !== undefined ? targetVersion === 'v3.0' : isV3Info(info);
  const isSourceV3 = isV3Info(info);
  const taskPlan = options?.taskPlan ?? buildExportTaskPlan(episodes, options?.tasks ?? {});
  const total = episodes.length;
  if (total === 0) {
    return isTargetV3 ? { episodes: new Map(), total_chunks: 0, total_files: 0 } : undefined;
  }

  if (isTargetV3 && !isSourceV3) {
    return mergeV2ToV3(dataLoader, info, episodes, adapter, taskPlan, onProgress, signal, options);
  } else if (!isTargetV3 && isSourceV3) {
    await splitV3ToV2(dataLoader, episodes, adapter, taskPlan, onProgress, signal, options);
  } else {
    return filterAndWriteSameVersion(
      dataLoader,
      info,
      episodes,
      adapter,
      taskPlan,
      onProgress,
      signal,
      options,
    );
  }
}

function dropColumns(table: Table, drop?: Set<string>): Table {
  if (!drop || drop.size === 0) return table;
  const keep = table.schema.fields.filter((f) => !drop.has(f.name)).map((f) => f.name);
  if (keep.length === table.schema.fields.length) return table;
  return table.select(keep);
}

async function filterAndWriteSameVersion(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  taskPlan: ExportTaskPlan,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options?: ExportDataOptions,
): Promise<V3DataLayout | undefined> {
  const total = episodes.length;
  if (isV3Info(info)) {
    return writeV3DataFiles(
      dataLoader,
      info,
      episodes,
      adapter,
      taskPlan,
      onProgress,
      signal,
      options,
    );
  } else {
    let globalRow = 0;
    for (let i = 0; i < episodes.length; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const ep = episodes[i];
      const table = await getValidatedEpisodeTable(dataLoader, ep);
      const stripped = dropColumns(table, options?.excludeColumns);
      const reindexed = rewriteEpisodeAndGlobalIndex(stripped, i, globalRow, taskPlan);
      globalRow += stripped.numRows;
      const chunkIdx = Math.floor(i / (info.chunks_size ?? CHUNK_SIZE_DEFAULT));
      const outPath = `data/chunk-${String(chunkIdx).padStart(3, '0')}/episode_${String(i).padStart(6, '0')}.parquet`;
      await ensureParentDir(adapter, outPath);
      const bytes = await tableToParquetBytes(reindexed);
      adapter.writeFile(outPath, bytes);
      onProgress?.({
        phase: 'data',
        current: i + 1,
        total,
        message: `Data episode ${i}`,
        cancelable: false,
      });
    }
  }
  return undefined;
}

async function mergeV2ToV3(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  taskPlan: ExportTaskPlan,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options?: ExportDataOptions,
): Promise<V3DataLayout> {
  return writeV3DataFiles(
    dataLoader,
    info,
    episodes,
    adapter,
    taskPlan,
    onProgress,
    signal,
    options,
  );
}

function positiveIntegerOrDefault(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return Number(value);
}

function positiveNumberOrDefault(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return value;
}

/**
 * Write whole episodes into size-bounded v3 Parquet files.
 *
 * Official LeRobot estimates the next episode's uncompressed contribution from
 * the current file's average bytes/frame before rotating. In the browser we
 * already have the complete Arrow tables, so serializing the candidate file
 * gives a deterministic and more accurate equivalent. Episodes remain atomic;
 * an individual oversized episode is written as one oversized file.
 */
async function writeV3DataFiles(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  taskPlan: ExportTaskPlan,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options?: ExportDataOptions,
): Promise<V3DataLayout> {
  const chunksSize = positiveIntegerOrDefault(info.chunks_size, CHUNK_SIZE_DEFAULT, 'chunks_size');
  const sizeLimitBytes =
    positiveNumberOrDefault(
      (info as { data_files_size_in_mb?: number }).data_files_size_in_mb,
      DATA_FILE_SIZE_MB_DEFAULT,
      'data_files_size_in_mb',
    ) * BYTES_PER_MB;
  const locations: V3DataLayout['episodes'] = new Map();
  let chunkIndex = 0;
  let fileIndex = 0;
  let globalRow = 0;
  let fileTables: Table[] = [];
  let fileBytes: Uint8Array | undefined;
  let totalFiles = 0;

  const flush = async (): Promise<void> => {
    if (fileTables.length === 0 || !fileBytes) return;
    const outPath = `data/chunk-${String(chunkIndex).padStart(3, '0')}/file-${String(fileIndex).padStart(3, '0')}.parquet`;
    await ensureParentDir(adapter, outPath);
    await adapter.writeFile(outPath, fileBytes);
    totalFiles++;
    fileTables = [];
    fileBytes = undefined;
  };

  const advanceFile = (): void => {
    if (fileIndex + 1 >= chunksSize) {
      chunkIndex++;
      fileIndex = 0;
    } else {
      fileIndex++;
    }
  };

  for (let outputEpisodeIndex = 0; outputEpisodeIndex < episodes.length; outputEpisodeIndex++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const episode = episodes[outputEpisodeIndex];
    const sourceTable = await getValidatedEpisodeTable(dataLoader, episode);
    const stripped = dropColumns(sourceTable, options?.excludeColumns);
    const table = rewriteEpisodeAndGlobalIndex(stripped, outputEpisodeIndex, globalRow, taskPlan);
    let candidateTables = [...fileTables, table];
    let candidateBytes = await tableToParquetBytes(concatTables(candidateTables));

    // Match the official >= boundary, but never emit an empty file.
    if (fileTables.length > 0 && candidateBytes.byteLength >= sizeLimitBytes) {
      await flush();
      advanceFile();
      candidateTables = [table];
      candidateBytes = await tableToParquetBytes(table);
    }

    locations.set(episode.episode_index, {
      chunk_index: chunkIndex,
      file_index: fileIndex,
      dataset_from_index: globalRow,
      dataset_to_index: globalRow + table.numRows,
    });
    globalRow += table.numRows;
    fileTables = candidateTables;
    fileBytes = candidateBytes;
    onProgress?.({
      phase: 'data',
      current: outputEpisodeIndex + 1,
      total: episodes.length,
      message: `Data chunk ${chunkIndex}, file ${fileIndex}`,
      cancelable: false,
    });
  }
  await flush();

  return {
    episodes: locations,
    total_files: totalFiles,
    total_chunks: totalFiles === 0 ? 0 : chunkIndex + 1,
  };
}

async function splitV3ToV2(
  dataLoader: LeRobotDataLoader,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  taskPlan: ExportTaskPlan,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options?: ExportDataOptions,
): Promise<void> {
  const chunksSize = 1000;
  let globalRow = 0;
  for (let i = 0; i < episodes.length; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const ep = episodes[i];
    if (!isV3Metadata(ep)) continue;
    const table = await getValidatedEpisodeTable(dataLoader, ep);
    const stripped = dropColumns(table, options?.excludeColumns);
    const reindexed = rewriteEpisodeAndGlobalIndex(stripped, i, globalRow, taskPlan);
    globalRow += stripped.numRows;
    const chunkIdx = Math.floor(i / chunksSize);
    const outPath = `data/chunk-${String(chunkIdx).padStart(3, '0')}/episode_${String(i).padStart(6, '0')}.parquet`;
    await ensureParentDir(adapter, outPath);
    const bytes = await tableToParquetBytes(reindexed);
    adapter.writeFile(outPath, bytes);
    onProgress?.({
      phase: 'data',
      current: i + 1,
      total: episodes.length,
      message: `Data episode ${i}`,
      cancelable: false,
    });
  }
}

function concatTables(tables: Table[]): Table {
  if (tables.length === 0) throw new Error('concatTables: empty');
  if (tables.length === 1) return tables[0];
  return tables[0].concat(...tables.slice(1));
}

async function ensureParentDir(adapter: ExportAdapter, filePath: string): Promise<void> {
  const parts = filePath.split('/');
  parts.pop();
  if (parts.length === 0) return;
  let path = '';
  for (const p of parts) {
    path += (path ? '/' : '') + p;
    await adapter.createDirectory(path);
  }
}
