import * as arrow from 'apache-arrow';
import type { Table } from 'apache-arrow';

/**
 * Serialize an Arrow Table to Parquet bytes (for export).
 * Per parquet-wasm API: writeParquet(table) consumes the table (__destroy_into_raw); do not call table.free() after.
 */
export async function tableToParquetBytes(table: Table): Promise<Uint8Array> {
  const { getParquetWasm } = await import('./parquetWasmLoader');
  const wasm = await getParquetWasm();
  const ipcBytes = arrow.tableToIPC(table, 'stream');
  const copy = new Uint8Array(ipcBytes.length);
  copy.set(ipcBytes);
  const wasmTable = wasm.Table.fromIPCStream(copy);
  return wasm.writeParquet(wasmTable);
}
