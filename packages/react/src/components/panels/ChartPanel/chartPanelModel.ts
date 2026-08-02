/**
 * Shared chart derivation for the aggregate uPlot and per-joint split view.
 */

import uPlot from 'uplot';
import type { LeRobotFeature, LeRobotInfo } from '@ioai/lerobot-studio-core';
import type { NumericalColumnData } from '@ioai/lerobot-studio-platform';
import { getChartSeriesKind } from '@ioai/lerobot-studio-core';
import { getChartPalette, getCssVarHsl, getLerobotRoot } from '../../../lib/chartTheme';

export type ChartSeriesKind = 'action' | 'state';

/** Stable id for one feature dimension (feature key + dim index). */
export function makeChartSeriesId(featureKey: string, dimIndex: number): string {
  return `${featureKey}::${dimIndex}`;
}

export type ChartDimensionMeta = {
  id: string;
  featureKey: string;
  dimIndex: number;
  jointName: string;
  kind: ChartSeriesKind;
};

export type ChartSeriesMeta = {
  id: string;
  featureKey: string;
  dimIndex: number;
  jointName: string;
  kind: ChartSeriesKind;
  color: string;
};

export type ChartSamplingMeta = {
  originalPoints: number;
  displayedPoints: number;
  stride: number;
  simplified: boolean;
};

export const ACTION_DASH: number[] = [8, 5];

export function makeSpreadIndices(n: number): number[] {
  if (n <= 0) return [];
  const used = new Array<boolean>(n).fill(false);
  const out: number[] = [];
  const queue: Array<[number, number]> = [[0, n - 1]];
  let qi = 0;
  while (qi < queue.length && out.length < n) {
    const [lo, hi] = queue[qi++]!;
    const mid = Math.floor((lo + hi) / 2);
    if (!used[mid]) {
      used[mid] = true;
      out.push(mid);
    }
    if (lo <= mid - 1) queue.push([lo, mid - 1]);
    if (mid + 1 <= hi) queue.push([mid + 1, hi]);
  }
  for (let i = 0; i < n && out.length < n; i++) {
    if (!used[i]) out.push(i);
  }
  return out;
}

export function sampleNumericColumn(
  column: NumericalColumnData,
  dimIndex: number,
  stride: number,
): Float64Array {
  const safeWidth = Math.max(1, column.width);
  const totalPoints = Math.ceil(column.rows / stride);
  const sampled = new Float64Array(totalPoints);
  let targetIndex = 0;
  for (let rowIndex = 0; rowIndex < column.rows; rowIndex += stride) {
    const valueIndex = rowIndex * safeWidth + Math.min(dimIndex, safeWidth - 1);
    sampled[targetIndex++] = column.values[valueIndex] ?? 0;
  }
  return sampled;
}

export function sampleTimestamps(timestamps: number[], stride: number): Float64Array {
  if (stride <= 1) return Float64Array.from(timestamps);
  const totalPoints = Math.ceil(timestamps.length / stride);
  const sampled = new Float64Array(totalPoints);
  let targetIndex = 0;
  for (let index = 0; index < timestamps.length; index += stride) {
    sampled[targetIndex++] = timestamps[index] ?? 0;
  }
  return sampled;
}

export function findClosestIndexInSortedArray(arr: number[], value: number): number {
  if (arr.length === 0) return 0;
  let lo = 0;
  let hi = arr.length - 1;
  if (value <= arr[0]!) return 0;
  if (value >= arr[hi]!) return hi;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const prev = Math.max(0, i - 1);
  return Math.abs(arr[i]! - value) < Math.abs(arr[prev]! - value) ? i : prev;
}

export function collectChartDimensions(
  targetFeatures: string[],
  features: LeRobotInfo['features'] | undefined,
  chartData?: Record<string, NumericalColumnData | undefined>,
): ChartDimensionMeta[] {
  const dimensions: ChartDimensionMeta[] = [];

  targetFeatures.forEach((featureKey) => {
    const featInfo = features?.[featureKey] as LeRobotFeature | undefined;
    if (!featInfo) return;
    const column = chartData?.[featureKey];
    const shape = featInfo.shape || [column?.width || 1];
    const dim = column ? Math.max(column.width, shape[0] ?? 1) : (shape[0] ?? 1);
    const names = Array.isArray(featInfo.names) ? featInfo.names : [];
    const kind = getChartSeriesKind(featureKey);

    for (let d = 0; d < dim; d++) {
      const jointName =
        (typeof names[d] === 'string' ? names[d] : null) || `${featureKey.split('.').pop()}[${d}]`;
      dimensions.push({
        id: makeChartSeriesId(featureKey, d),
        featureKey,
        dimIndex: d,
        jointName,
        kind,
      });
    }
  });

  return dimensions;
}

/** Unique joint names in dimension order (for split view ordering and colors). */
export function collectUniqueJointNames(dimensions: ChartDimensionMeta[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  dimensions.forEach((dim) => {
    if (seen.has(dim.jointName)) return;
    seen.add(dim.jointName);
    order.push(dim.jointName);
  });
  return order;
}

export function buildJointColorMap(
  allJointNames: string[],
  resolvedTheme: 'light' | 'dark',
): Record<string, string> {
  const map: Record<string, string> = {};
  const sorted = allJointNames.slice().sort();
  const spread = makeSpreadIndices(sorted.length);
  const themeRoot = getLerobotRoot();
  const palette = getChartPalette(themeRoot);
  const mutedFallback = resolvedTheme === 'dark' ? '#94a3b8' : '#64748b';
  sorted.forEach((name, i) => {
    const idx = spread[i] ?? i;
    map[name] =
      palette[idx % palette.length] ?? getCssVarHsl(themeRoot, '--muted-foreground', mutedFallback);
  });
  return map;
}

type CurrentFrameLike = { timestamp?: number | null };

export type ChartDataCore = {
  dimensions: ChartDimensionMeta[];
  allJointNames: string[];
  jointColorMap: Record<string, string>;
  simplifiedTimestamps: Float64Array;
  originalTimestamps: number[];
  stride: number;
  samplingMeta: ChartSamplingMeta;
  /** Sampled series values keyed by chart series id */
  seriesData: Record<string, Float64Array>;
  /** Series ids grouped by joint name (for split mini plots) */
  seriesIdsByJoint: Record<string, string[]>;
};

const MAX_DATA_POINTS = 2000;

export function computeChartDataCore(input: {
  chartData: Record<string, NumericalColumnData | undefined>;
  currentFrames: CurrentFrameLike[] | null | undefined;
  targetFeatures: string[];
  features: LeRobotInfo['features'] | undefined;
  resolvedTheme: 'light' | 'dark';
}): ChartDataCore | null {
  const { chartData, currentFrames, targetFeatures, features, resolvedTheme } = input;
  const timestampColumn = chartData.timestamp;
  if (!timestampColumn || timestampColumn.rows === 0) return null;

  const fullTimestamps =
    currentFrames && currentFrames.length > 0
      ? currentFrames.map((f) => Number(f.timestamp ?? 0))
      : Array.from(timestampColumn.values.slice(0, timestampColumn.rows));
  const alignedFullTimestamps = fullTimestamps.slice(0, timestampColumn.rows);
  const shouldSimplify = timestampColumn.rows > MAX_DATA_POINTS;
  const stride = shouldSimplify ? Math.ceil(timestampColumn.rows / MAX_DATA_POINTS) : 1;
  const simplifiedTimestamps = sampleTimestamps(alignedFullTimestamps, stride);
  const originalTimestamps =
    currentFrames && currentFrames.length > 0
      ? currentFrames.map((f) => Number(f.timestamp ?? 0))
      : Array.from(timestampColumn.values.slice(0, timestampColumn.rows));

  const dimensions = collectChartDimensions(targetFeatures, features, chartData);
  const allJointNames = collectUniqueJointNames(dimensions);
  const seriesData: Record<string, Float64Array> = {};
  const seriesIdsByJoint: Record<string, string[]> = {};

  for (const name of allJointNames) {
    seriesIdsByJoint[name] = [];
  }

  targetFeatures.forEach((featureKey) => {
    const featInfo = features?.[featureKey] as LeRobotFeature | undefined;
    const column = chartData[featureKey];
    if (!featInfo || !column) return;
    const shape = featInfo.shape || [column.width || 1];
    const dim = Math.max(column.width, shape[0] ?? 1);
    const names = Array.isArray(featInfo.names) ? featInfo.names : [];

    for (let d = 0; d < dim; d++) {
      const jointName =
        (typeof names[d] === 'string' ? names[d] : null) || `${featureKey.split('.').pop()}[${d}]`;
      const seriesId = makeChartSeriesId(featureKey, d);
      seriesData[seriesId] = sampleNumericColumn(column, d, stride);
      if (!seriesIdsByJoint[jointName]) seriesIdsByJoint[jointName] = [];
      seriesIdsByJoint[jointName]!.push(seriesId);
    }
  });

  return {
    dimensions,
    allJointNames,
    jointColorMap: buildJointColorMap(allJointNames, resolvedTheme),
    simplifiedTimestamps,
    originalTimestamps,
    stride,
    samplingMeta: {
      originalPoints: timestampColumn.rows,
      displayedPoints: simplifiedTimestamps.length,
      stride,
      simplified: shouldSimplify,
    },
    seriesData,
    seriesIdsByJoint,
  };
}

export function buildAggregatePreparedData(
  core: ChartDataCore,
  input: {
    selectedSeriesIds: Set<string>;
    showAction: boolean;
    showState: boolean;
    getStrokeColor: (seriesId: string, baseColor: string) => string;
    stateLabel: string;
    actionLabel: string;
  },
): {
  data: uPlot.AlignedData;
  configs: uPlot.Series[];
  seriesMeta: Array<ChartSeriesMeta | null>;
  originalTimestamps: number[];
  meta: ChartSamplingMeta;
} {
  const { selectedSeriesIds, showAction, showState, getStrokeColor, stateLabel, actionLabel } =
    input;

  const seriesDataArrays: Float64Array[] = [];
  const seriesMeta: Array<ChartSeriesMeta | null> = [null];
  const seriesConfigs: uPlot.Series[] = [{}];

  core.dimensions.forEach((dim) => {
    if (!selectedSeriesIds.has(dim.id)) return;
    if (dim.kind === 'state' && !showState) return;
    if (dim.kind === 'action' && !showAction) return;

    const arr = core.seriesData[dim.id];
    if (!arr) return;

    const baseColor = core.jointColorMap[dim.jointName] ?? '#94a3b8';
    const isState = dim.kind === 'state';
    const seriesLabel = `${isState ? stateLabel : actionLabel}: ${dim.featureKey} / ${dim.jointName}`;

    seriesDataArrays.push(arr);
    seriesConfigs.push({
      label: seriesLabel,
      stroke: () => getStrokeColor(dim.id, baseColor),
      width: isState ? 1.25 : 1.5,
      dash: isState ? [] : ACTION_DASH,
      points: { show: false },
      spanGaps: true,
    });
    seriesMeta.push({
      id: dim.id,
      featureKey: dim.featureKey,
      dimIndex: dim.dimIndex,
      jointName: dim.jointName,
      kind: dim.kind,
      color: baseColor,
    });
  });

  return {
    data: [core.simplifiedTimestamps, ...seriesDataArrays],
    configs: seriesConfigs,
    seriesMeta,
    originalTimestamps: core.originalTimestamps,
    meta: core.samplingMeta,
  };
}
