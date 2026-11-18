import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Float64,
  Int64,
  makeData,
  makeVector,
  Table,
  TimestampMicrosecond,
  TimestampNanosecond,
  tableToIPC,
  vectorFromArray,
  type Vector,
} from 'apache-arrow';
import { getParquetWasmNode } from './helpers/parquetWasmNode';
import { readParquetToIPC } from './helpers/parquet';
import {
  convertAuxiliaryTime,
  readAuxiliarySeries,
  type AuxiliarySeries,
} from '../src/platform/services/auxiliarySeries';
import { nearestSampleIndex } from '../src/react/components/panels/ChartPanel/chartGroupsModel';

const START_NS = 1_763_000_000_123_456_789n; // epoch ns, beyond Number precision

async function parquet(vectors: Record<string, Vector>): Promise<Uint8Array> {
  const wasm = await getParquetWasmNode();
  const ipc = tableToIPC(new Table(vectors), 'stream');
  return new Uint8Array(wasm.writeParquet(wasm.Table.fromIPCStream(ipc)));
}

let imuBytes: Uint8Array;
beforeAll(async () => {
  // 10 s of 200 Hz IMU with absolute int64 ns timestamps.
  const n = 2_000;
  imuBytes = await parquet({
    timestamp_ns: vectorFromArray(
      Array.from({ length: n }, (_, i) => START_NS + BigInt(i) * 5_000_000n),
      new Int64(),
    ),
    gyro_x: vectorFromArray(Float64Array.from({ length: n }, (_, i) => i)),
    gyro_y: vectorFromArray(
      Float64Array.from({ length: n }, (_, i) => -i),
      new Float64(),
    ),
  });
});

afterEach(() => vi.unstubAllGlobals());

function series(overrides: Partial<AuxiliarySeries> = {}): AuxiliarySeries {
  return {
    id: 'imu',
    label: 'Head IMU',
    files: [{ logicalPath: 'imu.parquet', presignedUrl: 'https://store.test/imu.parquet?sig=1' }],
    timeColumn: 'timestamp_ns',
    timeUnit: 'ns',
    timeOffsetNs: (-START_NS).toString(),
    ...overrides,
  };
}

const parse = (bytes: Uint8Array) => readParquetToIPC(bytes);

describe('auxiliary series', () => {
  it('keeps the native 200 Hz rate and aligns to a 30 fps playhead within one sample', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(imuBytes)),
    );
    const loaded = await readAuxiliarySeries(series(), 30, parse);

    expect(loaded.time).toHaveLength(2_000);
    expect(loaded.time[0]).toBe(0);
    expect(loaded.time[1]).toBeCloseTo(0.005, 12);
    expect(loaded.columns.map((column) => column.name)).toEqual(['gyro_x', 'gyro_y']);
    for (let frame = 0; frame < 300; frame++) {
      const t = frame / 30;
      const index = nearestSampleIndex(loaded.time, t);
      expect(Math.abs(loaded.time[index]! - t)).toBeLessThanOrEqual(0.005 / 2 + 1e-12);
      expect(loaded.columns[0]!.values[index]).toBe(index);
    }
  });

  it('adds the nanosecond offset exactly for int64 epoch timestamps', () => {
    const time = convertAuxiliaryTime(
      [START_NS + 1n, START_NS + 33_333_333n],
      'ns',
      30,
      (-START_NS).toString(),
    );
    expect(time[0]).toBe(1e-9);
    expect(time[1]).toBe(0.033333333);
    expect(convertAuxiliaryTime([0, 15, 30], 'frame', 30)).toEqual(Float64Array.from([0, 0.5, 1]));
  });

  it('reports a missing column as a typed warning and still returns the others', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(imuBytes)),
    );
    const loaded = await readAuxiliarySeries(series({ columns: ['gyro_x', 'gyro_z'] }), 30, parse);
    expect(loaded.columns.map((column) => column.name)).toEqual(['gyro_x']);
    expect(loaded.warnings).toEqual([
      expect.objectContaining({ code: 'COLUMN_MISSING', seriesId: 'imu', column: 'gyro_z' }),
    ]);
  });

  it('reports a missing time column without failing other series', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(imuBytes)),
    );
    const loaded = await readAuxiliarySeries(series({ timeColumn: 't' }), 30, parse);
    expect(loaded.columns).toEqual([]);
    expect(loaded.warnings[0]).toMatchObject({ code: 'TIME_COLUMN_MISSING', column: 't' });
  });

  it('concatenates several files and sorts by time', async () => {
    const later = await parquet({
      timestamp_ns: vectorFromArray([START_NS + 20_000_000_000n], new Int64()),
      gyro_x: vectorFromArray(Float64Array.from([99])),
      gyro_y: vectorFromArray(Float64Array.from([-99])),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(String(input).includes('later') ? later : imuBytes),
      ),
    );
    const loaded = await readAuxiliarySeries(
      series({
        files: [
          { logicalPath: 'b.parquet', presignedUrl: 'https://store.test/later.parquet' },
          { logicalPath: 'a.parquet', presignedUrl: 'https://store.test/imu.parquet' },
        ],
      }),
      30,
      parse,
    );
    expect(loaded.time).toHaveLength(2_001);
    expect(loaded.time.at(-1)).toBe(20);
    expect(loaded.columns[0]!.values.at(-1)).toBe(99);
  });

  it('reads a parquet TIMESTAMP(NANOS) time column exactly as int64 nanoseconds', async () => {
    const stamps = BigInt64Array.from([START_NS, START_NS + 1n, START_NS + 5_000_001n]);
    const bytes = await parquet({
      t: makeVector(makeData({ type: new TimestampNanosecond(), length: 3, data: stamps })),
      v: vectorFromArray(Float64Array.from([1, 2, 3])),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    );
    const loaded = await readAuxiliarySeries(
      series({ timeColumn: 't', columns: ['v'] }),
      30,
      parse,
    );
    expect(Array.from(loaded.time)).toEqual([0, 1e-9, 0.005000001]);
  });

  it('scales other timestamp units to nanoseconds, and refuses a timestamp column without ns', async () => {
    const micros = BigInt64Array.from([START_NS / 1000n, START_NS / 1000n + 2n]);
    const bytes = await parquet({
      t: makeVector(makeData({ type: new TimestampMicrosecond(), length: 2, data: micros })),
      v: vectorFromArray(Float64Array.from([1, 2])),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    );
    const loaded = await readAuxiliarySeries(
      series({
        timeColumn: 't',
        columns: ['v'],
        timeOffsetNs: (-(START_NS / 1000n) * 1000n).toString(),
      }),
      30,
      parse,
    );
    expect(Array.from(loaded.time)).toEqual([0, 0.000002]);
    const refused = await readAuxiliarySeries(
      series({ timeColumn: 't', columns: ['v'], timeUnit: 's' }),
      30,
      parse,
    );
    expect(refused.columns).toEqual([]);
    expect(refused.warnings[0]).toMatchObject({ code: 'TIME_UNIT_MISMATCH', column: 't' });
  });

  it('applies timeOffsetNs to s and frame time columns too', () => {
    expect(Array.from(convertAuxiliaryTime([10, 11], 's', 30, '-10000000000'))).toEqual([0, 1]);
    expect(Array.from(convertAuxiliaryTime([30, 60], 'frame', 30, '-1000000000'))).toEqual([0, 1]);
  });

  it('pads a column missing from one file, so values stay aligned with time', async () => {
    const withBoth = await parquet({
      ts: vectorFromArray(Float64Array.from([0, 1])),
      a: vectorFromArray(Float64Array.from([10, 11])),
      b: vectorFromArray(Float64Array.from([20, 21])),
    });
    const onlyA = await parquet({
      ts: vectorFromArray(Float64Array.from([2, 3])),
      a: vectorFromArray(Float64Array.from([12, 13])),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(String(input).includes('second') ? onlyA : withBoth),
      ),
    );
    const loaded = await readAuxiliarySeries(
      series({
        timeColumn: 'ts',
        timeUnit: 's',
        timeOffsetNs: undefined,
        files: [
          { logicalPath: 'first.parquet', presignedUrl: 'https://store.test/first.parquet' },
          { logicalPath: 'second.parquet', presignedUrl: 'https://store.test/second.parquet' },
        ],
      }),
      30,
      parse,
    );
    expect(Array.from(loaded.time)).toEqual([0, 1, 2, 3]);
    const b = loaded.columns.find((column) => column.name === 'b')!;
    expect(Array.from(b.values)).toEqual([20, 21, NaN, NaN]);
    expect(Array.from(loaded.columns.find((column) => column.name === 'a')!.values)).toEqual([
      10, 11, 12, 13,
    ]);
    expect(loaded.warnings).toEqual([
      expect.objectContaining({ code: 'COLUMN_MISSING', column: 'b' }),
    ]);
  });

  it('timeColumn null: row i is frame i, counted across files in order, every column plotted', async () => {
    const first = await parquet({
      score: vectorFromArray(Float64Array.from([0.5, 0.6, 0.7])),
      frame_index: vectorFromArray([0n, 1n, 2n], new Int64()),
    });
    const second = await parquet({
      score: vectorFromArray(Float64Array.from([0.8, 0.9])),
      frame_index: vectorFromArray([3n, 4n], new Int64()),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(String(input).includes('second') ? second : first),
      ),
    );
    const loaded = await readAuxiliarySeries(
      series({
        timeColumn: null,
        timeUnit: 'frame',
        timeOffsetNs: undefined,
        files: [
          { logicalPath: 'first.parquet', presignedUrl: 'https://store.test/first.parquet' },
          { logicalPath: 'second.parquet', presignedUrl: 'https://store.test/second.parquet' },
        ],
      }),
      10,
      parse,
    );
    expect(loaded.warnings).toEqual([]);
    expect(Array.from(loaded.time)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    // No column is the time column, so every numeric column is a series.
    expect(loaded.columns.map((column) => column.name)).toEqual(['score', 'frame_index']);
    expect(Array.from(loaded.columns[0]!.values)).toEqual([0.5, 0.6, 0.7, 0.8, 0.9]);
  });

  it.each(['s', 'ns'] as const)(
    'timeColumn null with timeUnit %s is refused with ROW_TIME_NEEDS_FRAME_UNIT, before any read',
    async (timeUnit) => {
      const fetchSpy = vi.fn(async () => new Response(imuBytes));
      vi.stubGlobal('fetch', fetchSpy);
      const loaded = await readAuxiliarySeries(series({ timeColumn: null, timeUnit }), 30, parse);
      expect(loaded.columns).toEqual([]);
      expect(loaded.time).toHaveLength(0);
      expect(loaded.warnings).toEqual([
        expect.objectContaining({ code: 'ROW_TIME_NEEDS_FRAME_UNIT', seriesId: 'imu' }),
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});
