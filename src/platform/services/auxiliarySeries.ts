import { tableFromIPC, Type, type Vector } from 'apache-arrow';
import type { RemoteFileEntry } from '../datasource/RemoteManifestDataSource';
import { RemoteManifestDataSource } from '../datasource/RemoteManifestDataSource';

/**
 * An extra time series read from separate parquet file(s) and aligned to the
 * dataset by its own time column (native-rate IMU, another process's
 * per-frame outputs, model predictions …).
 */
export interface AuxiliarySeries {
  /** Stable id; new `files` for the same id swap URLs without re-reading loaded data. */
  id: string;
  /** Label shown as the chart group title and in the series picker. */
  label: string;
  /** One or more parquet files, read in order and concatenated. */
  files: RemoteFileEntry[];
  /** Column holding each sample's time. */
  timeColumn: string;
  /**
   * `s` seconds, `ns` nanoseconds, or `frame` (dataset frame index, divided by
   * fps). An Arrow/parquet timestamp column is read exactly as nanoseconds and
   * needs `ns` (otherwise `TIME_UNIT_MISMATCH`).
   */
  timeUnit: 's' | 'ns' | 'frame';
  /**
   * Integer nanoseconds as a decimal string, added to every sample's time (for
   * example the negative recording start, so absolute timestamps become
   * seconds from the episode start). Applies to every unit; exact for int64
   * and timestamp columns with `ns`.
   */
  timeOffsetNs?: string;
  /** Numeric columns to plot; all numeric columns but the time column when omitted. */
  columns?: string[];
  /** Show only while this dataset episode is selected; every episode when omitted. */
  episodeIndex?: number;
}

/** Machine-readable auxiliary-series problems; other series keep drawing. */
export type AuxiliarySeriesWarningCode =
  | 'COLUMN_MISSING'
  | 'TIME_COLUMN_MISSING'
  | 'TIME_UNIT_MISMATCH'
  | 'READ_FAILED'
  | 'EPISODE_SET_UNSUPPORTED';

export interface AuxiliarySeriesWarning {
  code: AuxiliarySeriesWarningCode;
  seriesId: string;
  /** Column the warning is about, when there is one. */
  column?: string;
  message: string;
}

/** A loaded auxiliary series: native-rate samples, time in seconds from the episode start. */
export interface LoadedAuxiliarySeries {
  time: Float64Array;
  columns: Array<{ name: string; width: number; values: Float64Array }>;
  warnings: AuxiliarySeriesWarning[];
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return NaN;
}

function vectorWidth(vector: Vector, rows: number): number {
  for (let i = 0; i < rows; i++) {
    const value = vector.get(i) as unknown;
    if (value == null) continue;
    if (typeof value === 'number' || typeof value === 'bigint') return 1;
    if (typeof value === 'object' && value !== null && 'length' in value) {
      return Math.max(1, Number((value as { length: number }).length));
    }
    return 0;
  }
  return 1;
}

function isNumericVector(vector: Vector): boolean {
  const typeId = String(vector.type);
  return /Int|Float|Decimal|FixedSizeList|List/.test(typeId) && !/Utf8|Binary|Bool/.test(typeId);
}

/**
 * Convert one series' time values to seconds from the episode start.
 * `timeOffsetNs` applies to every unit; for `ns` it is added with BigInt
 * arithmetic, so int64 epoch timestamps stay exact before conversion.
 */
export function convertAuxiliaryTime(
  raw: ArrayLike<unknown>,
  unit: AuxiliarySeries['timeUnit'],
  fps: number,
  timeOffsetNs?: string,
): Float64Array {
  const out = new Float64Array(raw.length);
  const offset = timeOffsetNs ? BigInt(timeOffsetNs) : 0n;
  const offsetS = Number(offset) / 1e9;
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (unit === 'ns') {
      if (typeof value === 'bigint') out[i] = Number(value + offset) / 1e9;
      else out[i] = (toNumber(value) + Number(offset)) / 1e9;
    } else if (unit === 'frame') {
      out[i] = toNumber(value) / fps + offsetS;
    } else {
      out[i] = toNumber(value) + offsetS;
    }
  }
  return out;
}

const NS_PER_TIMESTAMP_UNIT = [1_000_000_000n, 1_000_000n, 1_000n, 1n];

/**
 * Raw values of a time column. Arrow `Timestamp` columns are read from their
 * int64 storage and scaled to nanoseconds exactly (Arrow's `get()` returns
 * float milliseconds, which loses nanoseconds); other columns use `get()`.
 */
function readTimeColumn(vector: Vector): { values: unknown[]; timestamp: boolean } {
  const values = new Array<unknown>(vector.length);
  if (vector.type.typeId !== Type.Timestamp) {
    for (let i = 0; i < vector.length; i++) values[i] = vector.get(i);
    return { values, timestamp: false };
  }
  const factor = NS_PER_TIMESTAMP_UNIT[(vector.type as { unit: number }).unit] ?? 1n;
  let row = 0;
  for (const data of vector.data) {
    const storage = data.values as unknown as BigInt64Array;
    for (let i = 0; i < data.length; i++, row++) {
      values[row] = data.getValid(i) ? BigInt(storage[data.offset + i]!) * factor : null;
    }
  }
  return { values, timestamp: true };
}

/**
 * Read an auxiliary series: fetch its files (typed remote errors), parse them
 * with `parse` (the dataset's parquet worker), convert time to seconds, keep
 * every sample (no resampling), and report missing columns as warnings.
 */
export async function readAuxiliarySeries(
  series: AuxiliarySeries,
  fps: number,
  parse: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<LoadedAuxiliarySeries> {
  const source = new RemoteManifestDataSource(series.files);
  const warnings: AuxiliarySeriesWarning[] = [];
  const times: Float64Array[] = [];
  const files: Array<{
    rows: number;
    columns: Map<string, { width: number; values: Float64Array }>;
  }> = [];
  const order: string[] = [];
  const wanted = series.columns ? [...series.columns] : null;
  const refuse = (warning: AuxiliarySeriesWarning): LoadedAuxiliarySeries => ({
    time: new Float64Array(),
    columns: [],
    warnings: [warning],
  });

  for (const file of series.files) {
    const ipc = await parse(await source.readBytes(file.logicalPath));
    const table = tableFromIPC(ipc);
    const rows = table.numRows;
    const timeVector = table.getChild(series.timeColumn);
    if (!timeVector) {
      return refuse({
        code: 'TIME_COLUMN_MISSING',
        seriesId: series.id,
        column: series.timeColumn,
        message: `Time column ${series.timeColumn} is missing in ${file.logicalPath}`,
      });
    }
    const rawTime = readTimeColumn(timeVector);
    if (rawTime.timestamp && series.timeUnit !== 'ns') {
      return refuse({
        code: 'TIME_UNIT_MISMATCH',
        seriesId: series.id,
        column: series.timeColumn,
        message: `Time column ${series.timeColumn} is a timestamp; use timeUnit 'ns'`,
      });
    }
    times.push(convertAuxiliaryTime(rawTime.values, series.timeUnit, fps, series.timeOffsetNs));

    const names =
      wanted ??
      table.schema.fields
        .map((field) => field.name)
        .filter((name) => name !== series.timeColumn && isNumericVector(table.getChild(name)!));
    const columns = new Map<string, { width: number; values: Float64Array }>();
    for (const name of names) {
      if (!order.includes(name)) order.push(name);
      const vector = table.getChild(name);
      if (!vector) continue;
      const width = vectorWidth(vector, rows);
      if (width === 0) continue;
      const values = new Float64Array(rows * width);
      for (let i = 0; i < rows; i++) {
        const value = vector.get(i) as unknown;
        if (width === 1) {
          values[i] = value == null ? NaN : toNumber(value);
        } else {
          const items = value == null ? [] : Array.from(value as Iterable<unknown>);
          for (let d = 0; d < width; d++) values[i * width + d] = toNumber(items[d]);
        }
      }
      columns.set(name, { width, values });
    }
    files.push({ rows, columns });
  }

  const concat = (parts: Float64Array[]) => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Float64Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  let time = concat(times);
  // One value per sample of every file: a column a file lacks is padded with
  // NaN for that file's rows, so values never shift against time.
  let columns: LoadedAuxiliarySeries['columns'] = [];
  for (const name of order) {
    const present = files.filter((file) => file.columns.has(name));
    if (present.length < files.length) {
      warnings.push({
        code: 'COLUMN_MISSING',
        seriesId: series.id,
        column: name,
        message:
          present.length === 0
            ? `Column ${name} is missing`
            : `Column ${name} is missing in ${files.length - present.length} of ${files.length} files`,
      });
    }
    if (present.length === 0) continue;
    const width = Math.max(...present.map((file) => file.columns.get(name)!.width));
    const parts = files.map((file) => {
      const column = file.columns.get(name);
      if (column && column.width === width) return column.values;
      const padded = new Float64Array(file.rows * width).fill(NaN);
      if (column) {
        for (let i = 0; i < file.rows; i++) {
          for (let d = 0; d < column.width; d++) {
            padded[i * width + d] = column.values[i * column.width + d]!;
          }
        }
      }
      return padded;
    });
    columns.push({ name, width, values: concat(parts) });
  }
  // Keep samples in time order (files may arrive out of order).
  let sorted = true;
  for (let i = 1; i < time.length; i++) {
    if (!(time[i]! >= time[i - 1]!)) {
      sorted = false;
      break;
    }
  }
  if (!sorted) {
    const order = Array.from(time.keys()).sort((a, b) => time[a]! - time[b]!);
    time = Float64Array.from(order, (i) => time[i]!);
    columns = columns.map((column) => {
      const values = new Float64Array(column.values.length);
      order.forEach((from, to) => {
        for (let d = 0; d < column.width; d++) {
          values[to * column.width + d] = column.values[from * column.width + d]!;
        }
      });
      return { ...column, values };
    });
  }
  return { time, columns, warnings };
}
