import { Float64, Int64, Table, tableToIPC, vectorFromArray, type Vector } from 'apache-arrow';
import { getParquetWasmNode } from './parquetWasmNode';

/** Column values for an in-memory parquet file: numbers become Float64, `bigint`s Int64. */
export type ParquetColumns = Record<string, Array<number | bigint>>;

/** Build parquet bytes in memory (tests only). */
export async function writeParquetBytes(columns: ParquetColumns): Promise<Uint8Array> {
  const parquet = await getParquetWasmNode();
  const vectors: Record<string, Vector> = {};
  for (const [name, values] of Object.entries(columns)) {
    vectors[name] =
      typeof values[0] === 'bigint'
        ? vectorFromArray(values as bigint[], new Int64())
        : vectorFromArray(values as number[], new Float64());
  }
  const ipc = tableToIPC(new Table(vectors), 'stream');
  const wasmTable = parquet.Table.fromIPCStream(ipc);
  return new Uint8Array(parquet.writeParquet(wasmTable));
}

/** Frame columns of a one-episode tree with `rows` rows at `fps`. */
export function oneEpisodeFrameColumns(rows: number, fps: number, stateOffset = 0): ParquetColumns {
  return {
    timestamp: Array.from({ length: rows }, (_, i) => i / fps),
    frame_index: Array.from({ length: rows }, (_, i) => BigInt(i)),
    index: Array.from({ length: rows }, (_, i) => BigInt(i)),
    episode_index: Array.from({ length: rows }, () => 0n),
    'observation.state': Array.from({ length: rows }, (_, i) => stateOffset + i),
    action: Array.from({ length: rows }, (_, i) => stateOffset + i + 0.5),
  };
}
