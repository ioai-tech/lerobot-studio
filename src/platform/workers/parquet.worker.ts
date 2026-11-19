/**
 * Parquet Worker: reads Parquet for the data loader and writes it for export.
 *
 * The page sends the parquet WASM's URL right after starting the worker; the
 * worker downloads and compiles it itself (see parquetWasmModule.ts) and every
 * call waits for that one load.
 */

import * as Comlink from 'comlink';
import { tableFromIPC, type Table } from 'apache-arrow';
import {
  Compression,
  ParquetFile,
  Table as WasmTable,
  WriterPropertiesBuilder,
  readParquet,
  writeParquet,
} from 'parquet-wasm';
import { announceStarted, handleInitMessage, initParquetWasm } from './parquetWasmModule';
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

interface FileCache {
  bufferHash: number;
  columnsKey: string;
  table: Table;
  arrowData: Uint8Array;
}

let fileCache: FileCache | null = null;

const post = (message: unknown) => self.postMessage(message);
self.addEventListener('message', (event: MessageEvent) => {
  handleInitMessage(event.data, post);
});

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

/** Wait for this worker's one parquet-wasm load (a failure is named and kept). */
function initWasm(): Promise<void> {
  return initParquetWasm();
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

  async writeParquet(ipcStream: Uint8Array, compression?: 'snappy'): Promise<Uint8Array> {
    await initWasm();
    // writeParquet consumes the table; no free() afterwards.
    const table = WasmTable.fromIPCStream(ipcStream);
    const properties =
      compression === 'snappy'
        ? new WriterPropertiesBuilder().setCompression(Compression.SNAPPY).build()
        : undefined;
    const bytes = writeParquet(table, properties);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },

  async clearCache(): Promise<void> {
    fileCache = null;
  },
};

Comlink.expose(api);
announceStarted(post);
