import * as arrow from 'apache-arrow';
import type { Table } from 'apache-arrow';
import type { LeRobotDataLoader } from '../services/LeRobotDataLoader';
import type { LeRobotInfo, EpisodeMetadata } from '@ioai/lerobot-studio-core';
import { isV3Info, isV3Metadata } from '@ioai/lerobot-studio-core';
import type { ExportAdapter } from '@ioai/lerobot-studio-core';
import type { ExportProgress } from '@ioai/lerobot-studio-core';
import { tableToParquetBytes } from './ParquetWriter';

const CHUNK_SIZE_DEFAULT = 1000;

/**
 * Produce a new Arrow table where the `episode_index` column is replaced with
 * a constant vector of `newEpisodeIndex`, and the `index` (global frame index)
 * column is replaced with `globalStart..globalStart+n-1`.
 *
 * This guarantees the exported dataset is self-contained and matches the
 * rewritten `meta/episodes` 0..N indexing – essential after users delete or
 * reorder episodes.
 */
function rewriteEpisodeAndGlobalIndex(
  table: Table,
  newEpisodeIndex: number,
  globalStart: number,
): Table {
  const n = table.numRows;
  if (n === 0) return table;
  const episodeIndex = new Int32Array(n);
  episodeIndex.fill(newEpisodeIndex);
  const index = new Int32Array(n);
  for (let i = 0; i < n; i++) index[i] = globalStart + i;

  const overrides: Record<string, Int32Array> = {};
  if (table.schema.fields.some((f) => f.name === 'episode_index')) {
    overrides.episode_index = episodeIndex;
  }
  if (table.schema.fields.some((f) => f.name === 'index')) {
    overrides.index = index;
  }
  if (Object.keys(overrides).length === 0) return table;

  const overrideTable = arrow.tableFromArrays(overrides);
  return table.assign(overrideTable) as unknown as Table;
}

export interface ExportDataOptions {
  /** Columns to strip from the exported parquet files (e.g. image features replaced by video). */
  excludeColumns?: Set<string>;
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
): Promise<void> {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const isTargetV3 = targetVersion?.startsWith('v3') ?? info.codebase_version.startsWith('v3');
  const isSourceV3 = info.codebase_version.startsWith('v3');
  const total = episodes.length;
  if (total === 0) return;

  if (isTargetV3 && !isSourceV3) {
    await mergeV2ToV3(dataLoader, info, episodes, adapter, onProgress, signal, options);
  } else if (!isTargetV3 && isSourceV3) {
    await splitV3ToV2(dataLoader, episodes, adapter, onProgress, signal, options);
  } else {
    await filterAndWriteSameVersion(
      dataLoader,
      info,
      episodes,
      adapter,
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
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options?: ExportDataOptions,
): Promise<void> {
  const total = episodes.length;
  if (isV3Info(info)) {
    // Output is packed into new 0-based v3 layout: one file per `chunks_size`
    // block of exported episodes (data/chunk-XXX/file-000.parquet). This makes
    // the exported dataset self-contained and resilient to the user deleting
    // episodes from arbitrary source chunks.
    const chunksSize = info.chunks_size ?? CHUNK_SIZE_DEFAULT;
    const chunkToIndices = new Map<number, number[]>();
    for (let i = 0; i < episodes.length; i++) {
      const chunkIdx = Math.floor(i / chunksSize);
      if (!chunkToIndices.has(chunkIdx)) chunkToIndices.set(chunkIdx, []);
      chunkToIndices.get(chunkIdx)!.push(i);
    }
    let globalRow = 0;
    let done = 0;
    for (const [chunkIdx, indices] of chunkToIndices.entries()) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const tables: Table[] = [];
      for (const i of indices) {
        const ep = episodes[i];
        const { table } = await dataLoader.getEpisodeTableForExport(ep.episode_index);
        const stripped = dropColumns(table, options?.excludeColumns);
        const reindexed = rewriteEpisodeAndGlobalIndex(stripped, i, globalRow);
        globalRow += stripped.numRows;
        tables.push(reindexed);
      }
      const merged = concatTables(tables);
      const outPath = `data/chunk-${String(chunkIdx).padStart(3, '0')}/file-000.parquet`;
      await ensureParentDir(adapter, outPath);
      const bytes = await tableToParquetBytes(merged);
      adapter.writeFile(outPath, bytes);
      done += indices.length;
      onProgress?.({
        phase: 'data',
        current: done,
        total,
        message: `Data chunk ${chunkIdx}`,
        cancelable: false,
      });
    }
  } else {
    let globalRow = 0;
    for (let i = 0; i < episodes.length; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const ep = episodes[i];
      const { table } = await dataLoader.getEpisodeTableForExport(ep.episode_index);
      const stripped = dropColumns(table, options?.excludeColumns);
      const reindexed = rewriteEpisodeAndGlobalIndex(stripped, i, globalRow);
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
}

async function mergeV2ToV3(
  dataLoader: LeRobotDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options?: ExportDataOptions,
): Promise<void> {
  const chunksSize = info.chunks_size ?? CHUNK_SIZE_DEFAULT;
  // Group exported episodes by NEW 0-based position into chunks. This guarantees
  // the output layout is self-contained regardless of the source episode_index
  // values.
  const chunkToIndices = new Map<number, number[]>();
  for (let i = 0; i < episodes.length; i++) {
    const chunkIdx = Math.floor(i / chunksSize);
    if (!chunkToIndices.has(chunkIdx)) chunkToIndices.set(chunkIdx, []);
    chunkToIndices.get(chunkIdx)!.push(i);
  }
  let done = 0;
  let globalRow = 0;
  for (const [chunkIdx, indices] of chunkToIndices.entries()) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const tables: Table[] = [];
    for (const i of indices) {
      const ep = episodes[i];
      const { table } = await dataLoader.getEpisodeTableForExport(ep.episode_index);
      const stripped = dropColumns(table, options?.excludeColumns);
      const reindexed = rewriteEpisodeAndGlobalIndex(stripped, i, globalRow);
      globalRow += stripped.numRows;
      tables.push(reindexed);
    }
    const merged = concatTables(tables);
    const bytes = await tableToParquetBytes(merged);
    const outPath = `data/chunk-${String(chunkIdx).padStart(3, '0')}/file-000.parquet`;
    await ensureParentDir(adapter, outPath);
    adapter.writeFile(outPath, bytes);
    done += indices.length;
    onProgress?.({
      phase: 'data',
      current: done,
      total: episodes.length,
      message: `Data chunk ${chunkIdx}`,
      cancelable: false,
    });
  }
}

async function splitV3ToV2(
  dataLoader: LeRobotDataLoader,
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
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
    const { table } = await dataLoader.getEpisodeTableForExport(ep.episode_index);
    const stripped = dropColumns(table, options?.excludeColumns);
    const reindexed = rewriteEpisodeAndGlobalIndex(stripped, i, globalRow);
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
