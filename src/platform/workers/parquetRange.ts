/**
 * Range-based parquet reads (hyparquet).
 *
 * The file is an AsyncBuffer over HTTP Range / File.slice: only the footer, the row groups that
 * overlap the requested rows and the requested column chunks are fetched. A 22-minute episode in a
 * 150 MB data file then costs the bytes of the columns on screen, not the whole file.
 *
 * Two caches live as long as the worker (they are not cleared when the episode changes):
 * - the footer metadata of the last few files, keyed on path and size;
 * - a small byte-budgeted LRU of the coalesced blocks read for row groups / column chunks, so going
 *   back to an episode, or reading another feature of the same row group, costs no request.
 *
 * Column chunks of one read are planned up front and coalesced into a few larger Range requests
 * (browsers allow six HTTP/1.1 connections per origin; many small requests queue behind video).
 */

import { parquetMetadataAsync, parquetRead, type AsyncBuffer, type FileMetaData } from 'hyparquet';

/** Reads bytes [start, end) of the file. */
export type RangeReader = (start: number, end: number) => Promise<ArrayBuffer>;

/** Identifies one file version: the metadata cache is keyed on it. */
export interface RangeFile {
  key: string;
  byteLength: number;
}

export interface NumericColumnResult {
  values: ArrayBuffer;
  rows: number;
  width: number;
}

const METADATA_CACHE_SIZE = 8;
/** Byte budget of cached row-group / column-chunk blocks. */
export const BLOCK_CACHE_BYTES = 48 * 1024 * 1024;
/** Two column chunks closer than this are read in one request (the gap is read and dropped). */
const COALESCE_GAP_BYTES = 512 * 1024;
/** Upper bound of one coalesced request. */
const COALESCE_MAX_BYTES = 16 * 1024 * 1024;

const metadataCache = new Map<string, Promise<FileMetaData>>();

interface Block {
  start: number;
  end: number;
  data: Promise<ArrayBuffer>;
  /** Byte size once resolved; pending blocks count with their requested size. */
  size: number;
}

/** LRU of byte blocks per file, bounded by a total byte budget. */
export class RangeBlockCache {
  private readonly blocks = new Map<string, Block>();
  private bytes = 0;
  private readonly budget: number;
  constructor(budget: number = BLOCK_CACHE_BYTES) {
    this.budget = budget;
  }

  get size(): number {
    return this.bytes;
  }

  get count(): number {
    return this.blocks.size;
  }

  clear(): void {
    this.blocks.clear();
    this.bytes = 0;
  }

  /** A cached block that covers [start, end) of `fileKey`, refreshed in the LRU order. */
  find(fileKey: string, start: number, end: number): Block | null {
    for (const [id, block] of this.blocks) {
      if (!id.startsWith(`${fileKey}\u0000`)) continue;
      if (block.start <= start && end <= block.end) {
        this.blocks.delete(id);
        this.blocks.set(id, block);
        return block;
      }
    }
    return null;
  }

  /** Bytes [start, end): from a cached block when one covers them, else one read that is cached. */
  read(fileKey: string, read: RangeReader, start: number, end: number): Promise<ArrayBuffer> {
    const hit = this.find(fileKey, start, end);
    if (hit) {
      return hit.data.then((buffer) => buffer.slice(start - hit.start, end - hit.start));
    }
    const id = `${fileKey}\u0000${start}-${end}`;
    const block: Block = { start, end, size: end - start, data: read(start, end) };
    // Larger than the whole budget: read through, never cache.
    if (block.size > this.budget) return block.data;
    this.blocks.set(id, block);
    this.bytes += block.size;
    block.data.then(
      (buffer) => {
        if (this.blocks.get(id) !== block) return;
        this.bytes += buffer.byteLength - block.size;
        block.size = buffer.byteLength;
        this.evict();
      },
      () => {
        // a failed or aborted read is never served from the cache
        if (this.blocks.get(id) === block) {
          this.blocks.delete(id);
          this.bytes -= block.size;
        }
      },
    );
    this.evict();
    return block.data.then((buffer) => buffer);
  }

  private evict(): void {
    while (this.bytes > this.budget && this.blocks.size > 1) {
      const oldest = this.blocks.keys().next().value;
      if (oldest === undefined) break;
      const block = this.blocks.get(oldest)!;
      this.blocks.delete(oldest);
      this.bytes -= block.size;
    }
  }
}

const blockCache = new RangeBlockCache();

/** Drops the footer metadata and the cached blocks (worker teardown, a new dataset). */
export function clearRangeMetadataCache(): void {
  metadataCache.clear();
  blockCache.clear();
}

/** Cache sizes, for tests and diagnostics. */
export function getRangeCacheStats(): { metadataFiles: number; blocks: number; bytes: number } {
  return { metadataFiles: metadataCache.size, blocks: blockCache.count, bytes: blockCache.size };
}

function cachedBuffer(file: RangeFile, read: RangeReader): AsyncBuffer {
  return {
    byteLength: file.byteLength,
    slice: (start: number, end?: number) =>
      blockCache.read(file.key, read, start, end ?? file.byteLength),
  };
}

function cachedMetadata(file: RangeFile, buffer: AsyncBuffer): Promise<FileMetaData> {
  const hit = metadataCache.get(file.key);
  if (hit) {
    // refresh LRU position
    metadataCache.delete(file.key);
    metadataCache.set(file.key, hit);
    return hit;
  }
  const pending = parquetMetadataAsync(buffer).catch((error: unknown) => {
    metadataCache.delete(file.key);
    throw error;
  });
  metadataCache.set(file.key, pending);
  while (metadataCache.size > METADATA_CACHE_SIZE) {
    const oldest = metadataCache.keys().next().value;
    if (oldest === undefined) break;
    metadataCache.delete(oldest);
  }
  return pending;
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Byte ranges of the column chunks of `columns` in the row groups overlapping [rowStart, rowEnd). */
export function planColumnChunkRanges(
  metadata: FileMetaData,
  columns: string[],
  rowStart: number,
  rowEnd: number,
): ByteRange[] {
  const wanted = new Set(columns);
  const ranges: ByteRange[] = [];
  let groupStart = 0;
  for (const rowGroup of metadata.row_groups) {
    const groupRows = Number(rowGroup.num_rows);
    const groupEnd = groupStart + groupRows;
    if (groupRows > 0 && groupEnd > rowStart && groupStart < rowEnd) {
      for (const chunk of rowGroup.columns) {
        const meta = chunk.meta_data;
        if (!meta || chunk.file_path || !wanted.has(meta.path_in_schema[0])) continue;
        const start = Number(meta.dictionary_page_offset || meta.data_page_offset);
        ranges.push({ start, end: start + Number(meta.total_compressed_size) });
      }
    }
    groupStart = groupEnd;
  }
  return ranges;
}

/** Sorted, merged ranges: neighbours closer than `gap` join while a run stays under `maxBytes`. */
export function coalesceRanges(
  ranges: ByteRange[],
  gap: number = COALESCE_GAP_BYTES,
  maxBytes: number = COALESCE_MAX_BYTES,
): ByteRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: ByteRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      range.start - last.end <= gap &&
      Math.max(last.end, range.end) - last.start <= maxBytes
    ) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return 0;
}

function isListValue(value: unknown): value is ArrayLike<unknown> {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

/** Column values for rows [startRow, endRow), assembled from the chunks hyparquet emits. */
async function readColumnRows(
  file: RangeFile,
  read: RangeReader,
  columns: string[],
  startRow: number,
  endRow: number,
): Promise<{ rows: number; start: number; byColumn: Map<string, unknown[]> }> {
  const buffer = cachedBuffer(file, read);
  const metadata = await cachedMetadata(file, buffer);
  const total = Number(metadata.num_rows);
  const start = Math.max(0, Math.min(startRow, total));
  const end = endRow <= 0 ? total : Math.max(start, Math.min(endRow, total));
  const rows = end - start;
  const byColumn = new Map<string, unknown[]>(columns.map((column) => [column, new Array(rows)]));
  if (rows === 0) return { rows, start, byColumn };

  const present = new Set(metadata.schema.map((element) => element.name));
  const readable = columns.filter((column) => present.has(column));
  if (readable.length === 0) return { rows, start, byColumn };

  // Fetch the planned chunks as a few coalesced blocks, all at once; hyparquet's own slices of a
  // chunk are then served from these blocks.
  const blocks = coalesceRanges(planColumnChunkRanges(metadata, readable, start, end));
  await Promise.all(blocks.map((block) => buffer.slice(block.start, block.end)));

  await parquetRead({
    file: buffer,
    metadata,
    columns: readable,
    rowStart: start,
    rowEnd: end,
    onChunk: ({ columnName, columnData, rowStart }) => {
      const target = byColumn.get(columnName);
      if (!target) return;
      // chunks may extend past the requested rows: copy only the overlap
      const from = Math.max(rowStart, start);
      const to = Math.min(rowStart + columnData.length, end);
      for (let row = from; row < to; row++) {
        target[row - start] = columnData[row - rowStart];
      }
    },
  });
  return { rows, start, byColumn };
}

/** Numeric columns as row-major Float64 buffers (`rows * width`), the shape `readNumericColumns` returns. */
export async function readNumericColumnsRange(
  file: RangeFile,
  read: RangeReader,
  columns: string[],
  startRow: number,
  endRow: number,
): Promise<Record<string, NumericColumnResult>> {
  const { rows, byColumn } = await readColumnRows(file, read, columns, startRow, endRow);
  const result: Record<string, NumericColumnResult> = {};
  for (const column of columns) {
    const cells = byColumn.get(column) ?? [];
    const sample = cells.find((cell) => cell !== null && cell !== undefined);
    const width = isListValue(sample) ? Math.max(1, sample.length) : 1;
    const values = new Float64Array(rows * width);
    for (let row = 0; row < rows; row++) {
      const cell = cells[row];
      if (isListValue(cell)) {
        const offset = row * width;
        const count = Math.min(width, cell.length);
        for (let item = 0; item < count; item++) values[offset + item] = toNumber(cell[item]);
      } else {
        values[row * width] = toNumber(cell);
      }
    }
    result[column] = { values: values.buffer, rows, width };
  }
  return result;
}

/** Raw cell values per column for rows [startRow, endRow); the caller converts them. */
export async function readFeatureRowsRange(
  file: RangeFile,
  read: RangeReader,
  columns: string[],
  startRow: number,
  endRow: number,
): Promise<Record<string, unknown[]>> {
  const { byColumn } = await readColumnRows(file, read, columns, startRow, endRow);
  return Object.fromEntries(columns.map((column) => [column, byColumn.get(column) ?? []]));
}

/** Reads and caches the footer of a file (prefetch for the next episode). */
export async function prefetchRangeMetadata(file: RangeFile, read: RangeReader): Promise<void> {
  await cachedMetadata(file, cachedBuffer(file, read));
}
