import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableFromIPC } from 'apache-arrow';
import init, { readParquet } from 'parquet-wasm/esm';

let initialized = false;

async function ensureParquetWasm(): Promise<void> {
  if (initialized) return;
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const wasmPath = path.resolve(
    currentDir,
    '../../node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm',
  );
  const wasmFile = await fs.readFile(wasmPath);
  await init({
    module_or_path: wasmFile.buffer.slice(
      wasmFile.byteOffset,
      wasmFile.byteOffset + wasmFile.byteLength,
    ),
  });
  initialized = true;
}

export async function readParquetToIPC(
  parquetBytes: Uint8Array,
  columns?: string[],
): Promise<Uint8Array> {
  await ensureParquetWasm();
  const wasmTable = readParquet(parquetBytes, columns ? { columns } : undefined);
  const arrowData = wasmTable.intoIPCStream();
  return new Uint8Array(arrowData);
}

export async function readNumericColumns(
  parquetBytes: Uint8Array,
  columns: string[],
  startRow: number,
  endRow: number,
): Promise<Record<string, { values: ArrayBuffer; rows: number; width: number }>> {
  const arrowData = await readParquetToIPC(parquetBytes, columns);
  const table = tableFromIPC(arrowData);
  const safeStart = Math.max(0, startRow);
  const safeEnd = Math.max(
    safeStart,
    endRow <= 0 ? table.numRows : Math.min(endRow, table.numRows),
  );
  const rows = safeEnd - safeStart;
  const result: Record<string, { values: ArrayBuffer; rows: number; width: number }> = {};

  columns.forEach((column) => {
    const vector = table.getChild(column);
    let width = 1;

    for (let rowIndex = safeStart; rowIndex < safeEnd; rowIndex++) {
      const sample = vector?.get(rowIndex);
      if (
        sample &&
        typeof sample === 'object' &&
        (sample.constructor.name.includes('Array') || 'toArray' in sample)
      ) {
        width = Array.from(sample as Iterable<unknown>).length || 1;
        break;
      }
    }

    const values = new Float64Array(rows * width);
    for (let rowIndex = safeStart; rowIndex < safeEnd; rowIndex++) {
      const rowOffset = (rowIndex - safeStart) * width;
      const cell = vector?.get(rowIndex);
      if (
        cell &&
        typeof cell === 'object' &&
        (cell.constructor.name.includes('Array') || 'toArray' in cell)
      ) {
        const items = Array.from(cell as Iterable<unknown>);
        for (let itemIndex = 0; itemIndex < width; itemIndex++) {
          const value = items[itemIndex];
          values[rowOffset + itemIndex] =
            typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0;
        }
      } else {
        values[rowOffset] =
          typeof cell === 'bigint' ? Number(cell) : typeof cell === 'number' ? cell : 0;
      }
    }

    result[column] = {
      values: values.buffer,
      rows,
      width,
    };
  });

  return result;
}

export async function readFeatureData(
  parquetBytes: Uint8Array,
  columns: string[],
  startRow: number,
  endRow: number,
): Promise<Record<string, unknown[]>> {
  const arrowData = await readParquetToIPC(parquetBytes, columns);
  const table = tableFromIPC(arrowData);
  const safeStart = Math.max(0, startRow);
  const safeEnd = Math.max(
    safeStart,
    endRow <= 0 ? table.numRows : Math.min(endRow, table.numRows),
  );
  const result: Record<string, unknown[]> = {};

  columns.forEach((column) => {
    const vector = table.getChild(column);
    const values: unknown[] = [];

    for (let rowIndex = safeStart; rowIndex < safeEnd; rowIndex++) {
      let value: unknown = vector?.get(rowIndex);
      if (typeof value === 'bigint') value = Number(value);

      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if ('bytes' in obj && typeof obj.bytes === 'object' && obj.bytes !== null) {
          const bytesObj = obj.bytes as Record<string, number>;
          if (
            typeof bytesObj === 'object' &&
            !Array.isArray(bytesObj) &&
            !(bytesObj instanceof Uint8Array)
          ) {
            const keys = Object.keys(bytesObj)
              .map((key) => parseInt(key, 10))
              .filter((key) => !Number.isNaN(key))
              .sort((left, right) => left - right);
            const bytesArray = new Uint8Array(keys.length);
            keys.forEach((key, index) => {
              bytesArray[index] = bytesObj[key.toString()];
            });
            value = bytesArray;
          } else if (bytesObj instanceof Uint8Array || bytesObj instanceof ArrayBuffer) {
            value = bytesObj instanceof ArrayBuffer ? new Uint8Array(bytesObj) : bytesObj;
          } else if (Array.isArray(bytesObj)) {
            value = new Uint8Array(bytesObj as number[]);
          }
        } else if ('toUint8Array' in obj && typeof obj.toUint8Array === 'function') {
          value = (obj as { toUint8Array: () => Uint8Array }).toUint8Array();
        } else if ('data' in obj && obj.data instanceof Uint8Array) {
          value = obj.data;
        } else if (value instanceof ArrayBuffer) {
          value = new Uint8Array(value);
        } else if (
          (value as { constructor: { name: string } }).constructor.name.includes('Array') ||
          'toArray' in obj
        ) {
          value = Array.from(value as Iterable<unknown>);
        }
      }

      values.push(value);
    }

    result[column] = values;
  });

  return result;
}
