/**
 * Parquet Worker - Vite inline 版本
 *
 * 从主线程接收预加载的 WASM ArrayBuffer 进行初始化。
 * 使用 Promise 等待机制替代轮询，彻底消除竞态条件：
 * 无论主线程何时发送 buffer，initWasm() 都会正确等待并初始化。
 */

import * as Comlink from 'comlink';
import { tableFromIPC, type Table } from 'apache-arrow';
import init, { ParquetFile, readParquet } from 'parquet-wasm';
import type {
  ParquetRangeFetcher,
  ParquetWorkerAPI,
  RangedParquetRead,
  RangedParquetSource,
} from '@/core';
import {
  extractFeatures,
  extractNumeric,
  readRangedTable,
  type NumericResult,
} from './parquetDecode';

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

function transferNumeric(result: NumericResult): NumericResult {
  return Comlink.transfer(
    result,
    Object.values(result).map((column) => column.values),
  );
}

async function readRanged(
  source: RangedParquetSource,
  fetchRange: ParquetRangeFetcher,
  read: RangedParquetRead,
): Promise<Table> {
  await initWasm();
  try {
    return await readRangedTable((file) => ParquetFile.fromFile(file), source, fetchRange, read);
  } finally {
    // Close the MessagePort of the main thread's fetch callback.
    (fetchRange as Partial<{ [Comlink.releaseProxy]: () => void }>)[Comlink.releaseProxy]?.();
  }
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
    const parsed = getParsedTable(new Uint8Array(buffer), columns);
    return transferNumeric(extractNumeric(parsed.table, columns, startRow, endRow));
  },

  async readFeatureData(
    buffer: ArrayBuffer,
    columns: string[],
    startRow: number,
    endRow: number,
  ): Promise<Record<string, unknown[]>> {
    await initWasm();
    const parsed = getParsedTable(new Uint8Array(buffer), columns);
    return extractFeatures(parsed.table, columns, startRow, endRow);
  },

  async readNumericColumnsRanged(
    source: RangedParquetSource,
    fetchRange: ParquetRangeFetcher,
    read: RangedParquetRead,
  ): Promise<Record<string, { values: ArrayBuffer; rows: number; width: number }>> {
    const table = await readRanged(source, fetchRange, read);
    return transferNumeric(extractNumeric(table, read.columns, 0, table.numRows));
  },

  async readFeatureDataRanged(
    source: RangedParquetSource,
    fetchRange: ParquetRangeFetcher,
    read: RangedParquetRead,
  ): Promise<Record<string, unknown[]>> {
    const table = await readRanged(source, fetchRange, read);
    return extractFeatures(table, read.columns, 0, table.numRows);
  },

  async clearCache(): Promise<void> {
    fileCache = null;
  },
};

// 暴露 API
Comlink.expose(api);
