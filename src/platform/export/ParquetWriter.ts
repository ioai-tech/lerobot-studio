import * as arrow from 'apache-arrow';
import type { Table } from 'apache-arrow';
import { writeParquetBytes } from './parquetWriteClient';

/**
 * Serialize an Arrow Table to Parquet bytes (for export), SNAPPY-compressed,
 * in a Parquet worker.
 */
export async function tableToParquetBytes(table: Table): Promise<Uint8Array> {
  return writeParquetBytes(arrow.tableToIPC(table, 'stream'), 'snappy');
}
