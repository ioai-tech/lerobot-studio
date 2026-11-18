import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Float64, Int64, Table, tableToIPC, vectorFromArray, type Vector } from 'apache-arrow';
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
});
