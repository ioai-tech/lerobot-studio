/**
 * Parquet Worker - Vite inline 版本
 *
 * 从主线程接收预加载的 WASM ArrayBuffer 进行初始化。
 * 使用 Promise 等待机制替代轮询，彻底消除竞态条件：
 * 无论主线程何时发送 buffer，initWasm() 都会正确等待并初始化。
 */

import * as Comlink from 'comlink';
import { tableFromIPC, type Table, type Vector } from 'apache-arrow';
import init, { readParquet } from 'parquet-wasm';
import type { ParquetWorkerAPI } from '@ioai/lerobot-studio-core';

let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

// 用 Promise 替代轮询：一旦收到 buffer 立即 resolve，永不超时
let wasmBufferResolve: ((buf: ArrayBuffer) => void) | null = null;
let wasmBufferReject: ((err: Error) => void) | null = null;
const wasmBufferSignal = new Promise<ArrayBuffer>((resolve, reject) => {
  wasmBufferResolve = resolve;
  wasmBufferReject = reject;
});

interface FileCache {
  bufferHash: number;
  columnsKey: string;
  table: Table;
  arrowData: Uint8Array;
}

let fileCache: FileCache | null = null;

// 接收主线程传来的 WASM ArrayBuffer（或错误通知）
self.onmessage = (event: MessageEvent) => {
  if (event.data.type === 'init-wasm') {
    wasmBufferResolve?.(event.data.wasmBuffer);
  } else if (event.data.type === 'init-wasm-error') {
    wasmBufferReject?.(new Error(`Main thread failed to load WASM: ${event.data.message}`));
  }
};

/**
 * 简单的 buffer hash
 */
function hashBuffer(buffer: Uint8Array): number {
  let hash = 0;
  const len = Math.min(buffer.length, 1000);
  for (let i = 0; i < len; i++) {
    hash = (hash << 5) - hash + buffer[i];
    hash = hash & hash;
  }
  return hash ^ buffer.length;
}

function getColumnsKey(columns?: string[]): string {
  return columns && columns.length > 0 ? [...columns].sort().join(',') : 'all';
}

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

function parseTable(uint8Array: Uint8Array, columns?: string[]): FileCache {
  const options = columns && columns.length > 0 ? { columns } : {};
  const wasmTable = readParquet(uint8Array, options);

  if (!wasmTable) {
    throw new Error('Failed to read parquet: wasmTable is null');
  }

  const arrowData = wasmTable.intoIPCStream();
  const cachedArrow = new Uint8Array(arrowData);
  const table = tableFromIPC(cachedArrow);

  return {
    bufferHash: hashBuffer(uint8Array),
    columnsKey: getColumnsKey(columns),
    table,
    arrowData: cachedArrow,
  };
}

function getParsedTable(uint8Array: Uint8Array, columns?: string[]): FileCache {
  const bufferHash = hashBuffer(uint8Array);
  const columnsKey = getColumnsKey(columns);
  if (fileCache?.bufferHash === bufferHash && fileCache.columnsKey === columnsKey) {
    return fileCache;
  }

  fileCache = parseTable(uint8Array, columns);
  return fileCache;
}

/**
 * 初始化 WASM：等待主线程发送的 ArrayBuffer，无竞态条件
 */
async function initWasm(): Promise<void> {
  if (wasmInitialized) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      const wasmBuffer = await wasmBufferSignal;
      await init({ module_or_path: wasmBuffer });
      wasmInitialized = true;
    } catch (e) {
      console.error('Worker: Failed to initialize WASM', e);
      wasmInitPromise = null;
      throw e;
    }
  })();

  return wasmInitPromise;
}

/**
 * 实现 ParquetWorkerAPI 接口
 */
const api: ParquetWorkerAPI = {
  async readParquet(buffer: ArrayBuffer, columns?: string[]): Promise<Uint8Array> {
    await initWasm();

    const uint8Array = new Uint8Array(buffer);
    if (uint8Array.length === 0) {
      throw new Error('Empty buffer passed to worker');
    }

    const parsed = getParsedTable(uint8Array, columns);
    const cloned = new Uint8Array(parsed.arrowData);
    return Comlink.transfer(cloned, [cloned.buffer]);
  },

  async readNumericColumns(
    buffer: ArrayBuffer,
    columns: string[],
    startRow: number,
    endRow: number,
  ): Promise<Record<string, { values: ArrayBuffer; rows: number; width: number }>> {
    await initWasm();

    const uint8Array = new Uint8Array(buffer);
    const parsed = getParsedTable(uint8Array, columns);
    const safeStart = Math.max(0, startRow);
    const boundedEnd = endRow <= 0 ? parsed.table.numRows : Math.min(endRow, parsed.table.numRows);
    const safeEnd = Math.max(safeStart, boundedEnd);
    const rows = safeEnd - safeStart;
    const result: Record<string, { values: ArrayBuffer; rows: number; width: number }> = {};
    const transferables: ArrayBuffer[] = [];

    columns.forEach((column) => {
      const vector = parsed.table.getChild(column);
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

      result[column] = {
        values: values.buffer,
        rows,
        width,
      };
      transferables.push(values.buffer);
    });

    return Comlink.transfer(result, transferables);
  },

  async readFeatureData(
    buffer: ArrayBuffer,
    columns: string[],
    startRow: number,
    endRow: number,
  ): Promise<Record<string, unknown[]>> {
    await initWasm();

    const uint8Array = new Uint8Array(buffer);
    const parsed = getParsedTable(uint8Array, columns);
    const safeStart = Math.max(0, startRow);
    const boundedEnd = endRow <= 0 ? parsed.table.numRows : Math.min(endRow, parsed.table.numRows);
    const safeEnd = Math.max(safeStart, boundedEnd);
    const result: Record<string, unknown[]> = {};

    columns.forEach((column) => {
      const vector = parsed.table.getChild(column);
      const rows: unknown[] = [];
      for (let rowIndex = safeStart; rowIndex < safeEnd; rowIndex++) {
        rows.push(convertFeatureValue(vector?.get(rowIndex)));
      }
      result[column] = rows;
    });

    return result;
  },

  async clearCache(): Promise<void> {
    fileCache = null;
  },
};

// 暴露 API
Comlink.expose(api);
