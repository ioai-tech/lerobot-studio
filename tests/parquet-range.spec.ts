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

describe('range block cache and coalescing', () => {
  it('coalesces nearby column chunks into one request and keeps separate far ones', async () => {
    const { coalesceRanges } = await import('../src/platform/workers/parquetRange');
    expect(
      coalesceRanges(
        [
          { start: 1_000, end: 2_000 },
          { start: 0, end: 900 },
          { start: 2_100, end: 3_000 },
          { start: 10_000_000, end: 10_001_000 },
        ],
        512 * 1024,
        16 * 1024 * 1024,
      ),
    ).toEqual([
      { start: 0, end: 3_000 },
      { start: 10_000_000, end: 10_001_000 },
    ]);
    // a run never grows past the request cap
    expect(
      coalesceRanges(
        [
          { start: 0, end: 600 },
          { start: 700, end: 1_300 },
        ],
        1_000,
        1_000,
      ),
    ).toEqual([
      { start: 0, end: 600 },
      { start: 700, end: 1_300 },
    ]);
  });

  it('serves slices from a cached block, evicts by byte budget and never caches failures', async () => {
    const { RangeBlockCache } = await import('../src/platform/workers/parquetRange');
    const cache = new RangeBlockCache(1_000);
    const bytes = Uint8Array.from({ length: 4_000 }, (_, index) => index % 251);
    const reads: Array<[number, number]> = [];
    const read = async (start: number, end: number) => {
      reads.push([start, end]);
      return bytes.slice(start, end).buffer as ArrayBuffer;
    };
    await cache.read('f', read, 0, 600);
    const inner = new Uint8Array(await cache.read('f', read, 100, 200));
    expect(inner[0]).toBe(100);
    expect(reads).toEqual([[0, 600]]);
    // another file with the same offsets is a different block
    await cache.read('g', read, 0, 600);
    expect(reads.length).toBe(2);
    // over budget: the least recently used block goes
    expect(cache.size).toBeLessThanOrEqual(1_000);
    await cache.read('f', read, 0, 600);
    expect(reads.length).toBe(3);

    const failing = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    await expect(cache.read('h', failing, 0, 10)).rejects.toThrow('aborted');
    await cache.read('h', read, 0, 10);
    expect(reads.at(-1)).toEqual([0, 10]);
  });

  it('keeps the footer and blocks across episode switches: a revisit reads nothing', async () => {
    clearRangeMetadataCache();
    const bytes = await buildParquet();
    const { reads, read } = countingReader(bytes);
    const file = { key: 'keep.parquet:1', byteLength: bytes.byteLength };
    await readNumericColumnsRange(file, read, ['timestamp', 'index'], 250, 420);
    const first = reads.length;
    expect(first).toBeGreaterThan(0);
    // another episode in another row group: only its chunks are read, not the footer again
    await readNumericColumnsRange(file, read, ['timestamp', 'index'], 6_000, 6_100);
    const second = reads.length - first;
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThanOrEqual(1);
    // back to the first episode: everything from the cache
    await readNumericColumnsRange(file, read, ['timestamp', 'index'], 250, 420);
    expect(reads.length).toBe(first + second);
  });
});
