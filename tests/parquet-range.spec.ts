import { describe, expect, it } from 'vitest';
import {
  Field,
  FixedSizeList,
  Float32,
  Int64,
  Table,
  makeData,
  makeVector,
  tableToIPC,
  vectorFromArray,
} from 'apache-arrow';

import {
  clearRangeMetadataCache,
  readFeatureRowsRange,
  readNumericColumnsRange,
} from '../src/platform/workers/parquetRange';
import { getParquetWasmNode } from './helpers/parquetWasmNode';

const ROWS = 20_000;
const ROW_GROUP = 2_000;
const WIDTH = 32;

async function buildParquet(): Promise<Uint8Array> {
  const { writeParquet, Table: WasmTable, WriterPropertiesBuilder } = await getParquetWasmNode();
  const flat = new Float32Array(ROWS * WIDTH);
  for (let row = 0; row < ROWS; row++) {
    for (let item = 0; item < WIDTH; item++) flat[row * WIDTH + item] = row + item / 100;
  }
  const child = makeData({ type: new Float32(), length: flat.length, data: flat });
  const listType = new FixedSizeList(WIDTH, new Field('item', new Float32(), false));
  const state = makeVector(makeData({ type: listType, length: ROWS, child }));
  const table = new Table({
    timestamp: vectorFromArray(
      Float32Array.from({ length: ROWS }, (_, row) => row / 30),
      new Float32(),
    ),
    index: vectorFromArray(
      Array.from({ length: ROWS }, (_, row) => BigInt(row)),
      new Int64(),
    ),
    'observation.state': state,
    'observation.big': vectorFromArray(
      Float32Array.from({ length: ROWS }, () => 7),
      new Float32(),
    ),
  });
  const properties = new WriterPropertiesBuilder().setMaxRowGroupSize(ROW_GROUP).build();
  return writeParquet(WasmTable.fromIPCStream(tableToIPC(table, 'stream')), properties);
}

function countingReader(bytes: Uint8Array) {
  const reads: Array<[number, number]> = [];
  const read = async (start: number, end: number) => {
    reads.push([start, end]);
    return bytes.slice(start, end).buffer as ArrayBuffer;
  };
  return { reads, read, fetched: () => reads.reduce((sum, [start, end]) => sum + end - start, 0) };
}

describe('range parquet reads', () => {
  it('reads one episode row range of the requested columns', async () => {
    clearRangeMetadataCache();
    const bytes = await buildParquet();
    const { read } = countingReader(bytes);
    const file = { key: 'data.parquet:1', byteLength: bytes.byteLength };

    const result = await readNumericColumnsRange(
      file,
      read,
      ['timestamp', 'observation.state', 'index'],
      250,
      420,
    );

    expect(result.timestamp.rows).toBe(170);
    expect(result.timestamp.width).toBe(1);
    expect(new Float64Array(result.timestamp.values)[0]).toBeCloseTo(250 / 30, 4);
    const state = result['observation.state'];
    expect(state.width).toBe(WIDTH);
    const values = new Float64Array(state.values);
    expect(values[0]).toBeCloseTo(250, 3);
    expect(values[169 * WIDTH + 3]).toBeCloseTo(419.03, 3);
    expect(new Float64Array(result.index.values)[169]).toBe(419);
  });

  it('fetches only the footer and the overlapping row groups of the requested columns', async () => {
    clearRangeMetadataCache();
    const bytes = await buildParquet();
    const counter = countingReader(bytes);
    const file = { key: 'data.parquet:2', byteLength: bytes.byteLength };

    await readNumericColumnsRange(file, counter.read, ['timestamp'], 0, ROW_GROUP);

    // one small column of one row group out of ten, plus the footer
    expect(counter.fetched()).toBeLessThan(bytes.byteLength / 4);
  });

  it('caches the footer per file key', async () => {
    clearRangeMetadataCache();
    const bytes = await buildParquet();
    const counter = countingReader(bytes);
    const file = { key: 'data.parquet:3', byteLength: bytes.byteLength };

    await readNumericColumnsRange(file, counter.read, ['timestamp'], 0, 10);
    const first = counter.reads.length;
    await readNumericColumnsRange(file, counter.read, ['timestamp'], 0, 10);
    expect(counter.reads.length - first).toBeLessThan(first);
  });

  it('returns an empty column for a name the file does not have', async () => {
    clearRangeMetadataCache();
    const bytes = await buildParquet();
    const { read } = countingReader(bytes);
    const file = { key: 'data.parquet:4', byteLength: bytes.byteLength };

    const rows = await readFeatureRowsRange(file, read, ['missing', 'observation.big'], 0, 5);
    expect(rows.missing).toHaveLength(5);
    expect(rows.missing[0]).toBeUndefined();
    expect(rows['observation.big']).toEqual([7, 7, 7, 7, 7]);
  });

  it('reads to the end of the file when endRow is 0', async () => {
    clearRangeMetadataCache();
    const bytes = await buildParquet();
    const { read } = countingReader(bytes);
    const file = { key: 'data.parquet:5', byteLength: bytes.byteLength };

    const result = await readNumericColumnsRange(file, read, ['timestamp'], 19_990, 0);
    expect(result.timestamp.rows).toBe(10);
  });
});
