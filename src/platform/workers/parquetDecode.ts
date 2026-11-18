/**
 * Arrow → plain values for the parquet worker (and its tests): numeric
 * columns as Float64 rows, feature values for the raw panel, and the ranged
 * read of a partly fetched file.
 */
import { tableFromIPC, type Table, type Vector } from 'apache-arrow';
import type { ParquetRangeFetcher, RangedParquetRead, RangedParquetSource } from '@/core';
import { SparseFile } from './sparseFile';

function isArrayLikeValue(
  value: unknown,
): value is Iterable<unknown> & { length?: number; toArray?: () => unknown[] } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { constructor?: { name?: string }; toArray?: () => unknown[] };
  return Boolean(
    candidate.constructor?.name?.includes('Array') || typeof candidate.toArray === 'function',
  );
}

function getArrayItems(value: Iterable<unknown> & { toArray?: () => unknown[] }): unknown[] {
  if (typeof value.toArray === 'function') {
    return value.toArray();
  }
  return Array.from(value);
}

function getNumericWidth(
  vector: Vector | null | undefined,
  startRow: number,
  endRow: number,
): number {
  if (!vector) return 1;

  for (let rowIndex = startRow; rowIndex < endRow; rowIndex++) {
    const sample = vector.get(rowIndex);
    if (sample === null || sample === undefined) continue;
    if (typeof sample === 'number' || typeof sample === 'bigint') return 1;
    if (isArrayLikeValue(sample)) {
      const items = getArrayItems(sample);
      return Math.max(1, items.length);
    }
    return 1;
  }

  return 1;
}

function toNumericValue(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return 0;
}

function convertFeatureValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('bytes' in obj && obj.bytes !== null && obj.bytes !== undefined) {
      const bytes = obj.bytes;
      if (bytes instanceof Uint8Array) return bytes;
      if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
      if (Array.isArray(bytes)) return new Uint8Array(bytes as number[]);
      if (typeof bytes === 'object') {
        const entries = Object.entries(bytes as Record<string, number>)
          .map(([key, byte]) => [Number(key), byte] as const)
          .filter(([key]) => Number.isFinite(key))
          .sort((left, right) => left[0] - right[0]);
        return new Uint8Array(entries.map(([, byte]) => byte));
      }
    }

    if ('toUint8Array' in obj && typeof obj.toUint8Array === 'function') {
      return (obj as { toUint8Array: () => Uint8Array }).toUint8Array();
    }

    if ('data' in obj && obj.data instanceof Uint8Array) {
      return obj.data;
    }

    if (isArrayLikeValue(value)) {
      return getArrayItems(value).map((item) => convertFeatureValue(item));
    }
  }

  return value;
}

export type NumericResult = Record<string, { values: ArrayBuffer; rows: number; width: number }>;

export function extractNumeric(
  table: Table,
  columns: string[],
  startRow: number,
  endRow: number,
): NumericResult {
  const safeStart = Math.max(0, startRow);
  const boundedEnd = endRow <= 0 ? table.numRows : Math.min(endRow, table.numRows);
  const safeEnd = Math.max(safeStart, boundedEnd);
  const rows = safeEnd - safeStart;
  const result: NumericResult = {};

  columns.forEach((column) => {
    const vector = table.getChild(column);
    const width = getNumericWidth(vector, safeStart, safeEnd);
    const values = new Float64Array(rows * width);

    for (let rowIndex = safeStart; rowIndex < safeEnd; rowIndex++) {
      const rowOffset = (rowIndex - safeStart) * width;
      const cellValue = vector?.get(rowIndex);

      if (isArrayLikeValue(cellValue)) {
        const items = getArrayItems(cellValue);
        for (let itemIndex = 0; itemIndex < width; itemIndex++) {
          values[rowOffset + itemIndex] = toNumericValue(items[itemIndex]);
        }
      } else {
        values[rowOffset] = toNumericValue(cellValue);
      }
    }

    result[column] = { values: values.buffer, rows, width };
  });
  return result;
}

export function extractFeatures(
  table: Table,
  columns: string[],
  startRow: number,
  endRow: number,
): Record<string, unknown[]> {
  const safeStart = Math.max(0, startRow);
  const boundedEnd = endRow <= 0 ? table.numRows : Math.min(endRow, table.numRows);
  const safeEnd = Math.max(safeStart, boundedEnd);
  const result: Record<string, unknown[]> = {};

  columns.forEach((column) => {
    const vector = table.getChild(column);
    const rows: unknown[] = [];
    for (let rowIndex = safeStart; rowIndex < safeEnd; rowIndex++) {
      rows.push(convertFeatureValue(vector?.get(rowIndex)));
    }
    result[column] = rows;
  });
  return result;
}

/** What `readRangedTable` needs of parquet-wasm's `ParquetFile`. */
export interface AsyncParquetFile {
  read(options: {
    columns: string[];
    rowGroups: number[];
    offset: number;
    limit: number;
  }): Promise<{ intoIPCStream(): Uint8Array }>;
  free(): void;
}

/**
 * Decode `read.columns` for rows [offset, offset + limit) of the selected row
 * groups from a partly fetched file: parquet-wasm's async reader asks for the
 * byte ranges it needs (the selected columns' chunks of those row groups);
 * anything the main thread did not prefetch is fetched through `fetchRange`.
 */
export async function readRangedTable(
  open: (file: Blob) => Promise<AsyncParquetFile>,
  source: RangedParquetSource,
  fetchRange: ParquetRangeFetcher,
  read: RangedParquetRead,
): Promise<Table> {
  const file = new SparseFile(
    {
      size: source.size,
      parts: source.parts.map((part) => ({ start: part.start, bytes: new Uint8Array(part.bytes) })),
    },
    fetchRange,
  );
  const parquetFile = await open(file as unknown as Blob);
  try {
    const wasmTable = await parquetFile.read({
      columns: read.columns,
      rowGroups: read.rowGroups,
      offset: read.offset,
      limit: read.limit,
    });
    return tableFromIPC(wasmTable.intoIPCStream());
  } finally {
    parquetFile.free();
  }
}
