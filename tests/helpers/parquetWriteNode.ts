import { getParquetWasmNode } from './parquetWasmNode';

/** Node stand-in for src/platform/export/parquetWriteClient.ts (no workers in unit tests). */
export async function writeParquetBytes(
  ipcStream: Uint8Array,
  compression?: 'snappy',
): Promise<Uint8Array> {
  const wasm = await getParquetWasmNode();
  const table = wasm.Table.fromIPCStream(ipcStream);
  const properties =
    compression === 'snappy'
      ? new wasm.WriterPropertiesBuilder().setCompression(wasm.Compression.SNAPPY).build()
      : undefined;
  return wasm.writeParquet(table, properties);
}
