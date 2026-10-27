/**
 * Range-based parquet reads (hyparquet).
 *
 * The file is an AsyncBuffer over HTTP Range / File.slice: only the footer, the row groups that
 * overlap the requested rows and the requested column chunks are fetched. A 22-minute episode in a
 * 150 MB data file then costs the bytes of the columns on screen, not the whole file.
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
const metadataCache = new Map<string, Promise<FileMetaData>>();

export function clearRangeMetadataCache(): void {
  metadataCache.clear();
}

function asyncBuffer(file: RangeFile, read: RangeReader): AsyncBuffer {
  return {
    byteLength: file.byteLength,
    slice: (start: number, end?: number) => read(start, end ?? file.byteLength),
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
  const buffer = asyncBuffer(file, read);
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
