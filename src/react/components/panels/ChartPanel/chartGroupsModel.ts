/**
 * Chart groups: one chart per feature (`action`, `observation.state`, an
 * auxiliary series …), titled by the feature key, series named from
 * `info.features[key].names`, with units when the feature declares them.
 */
import type { LeRobotFeature, LeRobotInfo } from '@/core';
import type { NumericalColumnData } from '@/platform';
import { makeChartSeriesId } from './chartPanelModel';

/** Dimensions shown by default per chart group (the rest are one click away). */
export const DEFAULT_VISIBLE_DIMENSIONS = 8;

export interface ChartGroupSeries {
  /** Stable id (`<feature>::<dim>`), shared with the series picker. */
  id: string;
  /** Display name: the feature's declared name for the dimension, else `key[d]`. */
  label: string;
  dimIndex: number;
}

export interface ChartGroup {
  /** Feature key, or `aux:<id>` for an auxiliary series. */
  id: string;
  /** Title: the feature key (or the auxiliary series label). */
  title: string;
  /** Unit declared by the feature, if any. */
  unit: string | null;
  kind: 'feature' | 'auxiliary';
  series: ChartGroupSeries[];
}

/**
 * Unit declared by a feature. LeRobot has no standard key; `unit` / `units`
 * (string, or one string for every dimension) on the feature or its `info`
 * are honoured. Mixed per-dimension units are not merged into one title.
 */
export function featureUnit(feature: unknown): string | null {
  const record = (feature ?? {}) as Record<string, unknown>;
  const info = (record.info ?? {}) as Record<string, unknown>;
  for (const value of [record.unit, record.units, info.unit, info.units]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length > 0) {
      const distinct = new Set(value.filter((item) => typeof item === 'string'));
      if (distinct.size === 1) return [...distinct][0] as string;
    }
  }
  return null;
}

/** One group per numeric feature, in the given order. */
export function buildFeatureChartGroups(
  targetFeatures: string[],
  features: LeRobotInfo['features'] | undefined,
  chartData: Record<string, NumericalColumnData | undefined>,
): ChartGroup[] {
  const groups: ChartGroup[] = [];
  for (const key of targetFeatures) {
    const feature = features?.[key] as LeRobotFeature | undefined;
    if (!feature) continue;
    const column = chartData[key];
    const width = column
      ? Math.max(column.width, feature.shape?.[0] ?? 1)
      : (feature.shape?.[0] ?? 1);
    const names = Array.isArray(feature.names) ? feature.names : [];
    const shortKey = key.split('.').pop() || key;
    groups.push({
      id: key,
      title: key,
      unit: featureUnit(feature),
      kind: 'feature',
      series: Array.from({ length: width }, (_, d) => ({
        id: makeChartSeriesId(key, d),
        label: (typeof names[d] === 'string' && names[d]) || `${shortKey}[${d}]`,
        dimIndex: d,
      })),
    });
  }
  return groups;
}

/** Ids visible by default: the first `DEFAULT_VISIBLE_DIMENSIONS` of every group. */
export function defaultVisibleSeriesIds(groups: ChartGroup[]): string[] {
  return groups.flatMap((group) =>
    group.series.slice(0, DEFAULT_VISIBLE_DIMENSIONS).map((series) => series.id),
  );
}

/**
 * Min/max decimation for drawing: each pixel column keeps its first, minimum,
 * maximum and last sample of every series (at the bucket's x positions), so
 * the drawn envelope is identical to drawing every sample. Inputs with at
 * most ~4 samples per pixel are returned unchanged.
 */
export function decimateMinMax(
  x: ArrayLike<number>,
  ys: ArrayLike<number>[],
  pixelWidth: number,
): { x: Float64Array; ys: Float64Array[] } {
  const n = x.length;
  const buckets = Math.max(1, Math.floor(pixelWidth));
  if (n <= buckets * 4) {
    return {
      x: Float64Array.from(x),
      ys: ys.map((y) => Float64Array.from(y, (v) => (Number.isFinite(v) ? v : NaN))),
    };
  }
  const outX: number[] = [];
  const outYs: number[][] = ys.map(() => []);
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * n) / buckets);
    const to = Math.floor(((b + 1) * n) / buckets);
    if (to <= from) continue;
    const last = to - 1;
    // Four points per bucket: first, min, max, last (min/max placed in time order).
    const xs = [
      x[from]!,
      x[from + Math.floor((last - from) / 3)]!,
      x[from + Math.floor((2 * (last - from)) / 3)]!,
      x[last]!,
    ];
    outX.push(...xs);
    ys.forEach((y, s) => {
      // Gaps (NaN, ±Infinity) are skipped; a bucket without a finite sample
      // stays a gap instead of an infinite extreme that breaks the y scale.
      let min = Infinity;
      let max = -Infinity;
      let minAt = -1;
      let maxAt = -1;
      for (let i = from; i < to; i++) {
        const v = y[i]!;
        if (!Number.isFinite(v)) continue;
        if (v < min) {
          min = v;
          minAt = i;
        }
        if (v > max) {
          max = v;
          maxAt = i;
        }
      }
      const finiteOrGap = (v: number) => (Number.isFinite(v) ? v : NaN);
      if (minAt < 0) {
        outYs[s]!.push(NaN, NaN, NaN, NaN);
        return;
      }
      const [lo, hi] = minAt <= maxAt ? [min, max] : [max, min];
      outYs[s]!.push(finiteOrGap(y[from]!), lo, hi, finiteOrGap(y[last]!));
    });
  }
  return { x: Float64Array.from(outX), ys: outYs.map((values) => Float64Array.from(values)) };
}

/** Index range `[from, to)` of the samples to draw for `[min, max]`, plus one neighbour each side. */
export function visibleSampleRange(
  x: ArrayLike<number>,
  min: number,
  max: number,
): [number, number] {
  const lowerBound = (value: number) => {
    let lo = 0;
    let hi = x.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upperBound = (value: number) => {
    let lo = 0;
    let hi = x.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return [Math.max(0, lowerBound(min) - 1), Math.min(x.length, upperBound(max) + 1)];
}

/** Values of one dimension of a numeric column. */
export function columnDimension(column: NumericalColumnData, dimIndex: number): Float64Array {
  const width = Math.max(1, column.width);
  const out = new Float64Array(column.rows);
  const d = Math.min(dimIndex, width - 1);
  for (let row = 0; row < column.rows; row++) out[row] = column.values[row * width + d] ?? NaN;
  return out;
}

/** Index of the sample nearest to `time` in an ascending array. */
export function nearestSampleIndex(times: ArrayLike<number>, time: number): number {
  const n = times.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  if (time <= times[0]!) return 0;
  if (time >= times[hi]!) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= time) lo = mid;
    else hi = mid;
  }
  return time - times[lo]! <= times[hi]! - time ? lo : hi;
}
