import type { Table } from 'apache-arrow';
import type { EpisodeMetadata, LeRobotFeature, LeRobotInfo } from '../types/lerobot';
import { SUBTASK_INDEX_FEATURE_KEY } from '../subtask';

export interface StatsDataLoader {
  getEpisodeTableForExport(episodeIndex: number): Promise<{ table: Table }>;
}

/** Recursive JSON array; visual stats have shape [channels][1][1]. */
export type StatsArray = Array<number | StatsArray>;

export interface FeatureStats {
  min: StatsArray;
  max: StatsArray;
  mean: StatsArray;
  std: StatsArray;
  q01: StatsArray;
  q10: StatsArray;
  q50: StatsArray;
  q90: StatsArray;
  q99: StatsArray;
  count: number[];
}

export type DatasetStats = Record<string, FeatureStats>;
export type NumericFeatureRow = number | readonly number[];

export interface NumericStatsRowContext {
  episode: EpisodeMetadata;
  outputEpisodeIndex: number;
  rowIndex: number;
  outputGlobalIndex: number;
  sourceValues: readonly number[];
}

export interface ComputeDatasetStatsOptions {
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
  /**
   * Return the final exported value for a numeric feature, or undefined to use
   * the source value. This is the integration point for rewritten index,
   * episode_index, and task_index columns.
   */
  resolveNumericRow?: (
    featureKey: string,
    context: NumericStatsRowContext,
  ) => NumericFeatureRow | undefined;
  /** Supply unflattened per-episode stats if EpisodeMetadata does not contain stats/* fields. */
  getEpisodeStats?: (
    episode: EpisodeMetadata,
  ) =>
    | Record<string, FeatureStats | Record<string, unknown>>
    | undefined
    | Promise<Record<string, FeatureStats | Record<string, unknown>> | undefined>;
}

const STAT_KEYS = ['min', 'max', 'mean', 'std', 'q01', 'q10', 'q50', 'q90', 'q99'] as const;
const QUANTILES = [
  ['q01', 0.01],
  ['q10', 0.1],
  ['q50', 0.5],
  ['q90', 0.9],
  ['q99', 0.99],
] as const;
const NUM_BINS = 5000;

function isNumeric(feature: LeRobotFeature): boolean {
  const dtype = feature.dtype.toLowerCase();
  return (
    dtype.includes('float') || dtype.includes('int') || dtype.includes('uint') || dtype === 'bool'
  );
}

function isVisual(feature: LeRobotFeature): boolean {
  const dtype = feature.dtype.toLowerCase();
  return (
    dtype === 'image' ||
    dtype === 'video' ||
    dtype === 'depth' ||
    feature.info?.is_depth_map === true
  );
}

function featureDim(feature: LeRobotFeature): number {
  return feature.shape.length > 0 ? feature.shape[0] : 1;
}

function visualChannels(feature: LeRobotFeature): number {
  const names = Array.isArray(feature.names)
    ? feature.names.map((name) => String(name).toLowerCase())
    : [];
  const namedChannel = names.findIndex((name) => name === 'channel' || name === 'channels');
  if (namedChannel >= 0 && feature.shape[namedChannel] != null) return feature.shape[namedChannel];
  if (feature.shape.length >= 3) {
    if (feature.shape[0] === 1 || feature.shape[0] === 3) return feature.shape[0];
    if (feature.shape.at(-1) === 1 || feature.shape.at(-1) === 3) return feature.shape.at(-1)!;
  }
  return 1;
}

function numericRow(
  vector: ReturnType<Table['getChild']>,
  row: number,
  dim: number,
): number[] | null {
  const value = vector?.get(row);
  if (typeof value === 'boolean') return dim === 1 ? [value ? 1 : 0] : null;
  if (typeof value === 'number') return Number.isFinite(value) && dim === 1 ? [value] : null;
  if (typeof value === 'bigint') {
    const converted = Number(value);
    if (!Number.isSafeInteger(converted)) {
      throw new RangeError(`Numeric feature contains unsafe int64 value: ${value}`);
    }
    return dim === 1 ? [converted] : null;
  }
  let values: unknown[] | undefined;
  if (Array.isArray(value)) values = value;
  else if (value && typeof (value as { toArray?: () => unknown[] }).toArray === 'function') {
    values = Array.from((value as { toArray: () => unknown[] }).toArray());
  }
  if (!values || values.length !== dim) return null;
  const converted = values.map((item) => Number(item));
  if (
    converted.some(
      (item, index) =>
        !Number.isFinite(item) ||
        (typeof values?.[index] === 'bigint' && !Number.isSafeInteger(item)),
    )
  ) {
    return null;
  }
  return converted;
}

function plainArray(value: unknown): StatsArray | null {
  if (typeof value === 'boolean') return [value ? 1 : 0];
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : null;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return plainArray(Array.from(value as unknown as Iterable<number>));
  }
  if (!Array.isArray(value)) {
    const arrayLike = value as { toArray?: () => unknown };
    return typeof arrayLike?.toArray === 'function' ? plainArray(arrayLike.toArray()) : null;
  }
  const output: StatsArray = [];
  for (const item of value) {
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return null;
      output.push(item);
    } else {
      const nested = plainArray(item);
      if (!nested) return null;
      output.push(nested);
    }
  }
  return output;
}

function shapeOf(value: StatsArray): number[] {
  const shape: number[] = [];
  let current: number | StatsArray = value;
  while (Array.isArray(current)) {
    shape.push(current.length);
    if (current.length === 0) break;
    const childShapes = current
      .filter(Array.isArray)
      .map((child) => JSON.stringify(shapeOf(child as StatsArray)));
    if (
      current.some((child) => Array.isArray(child)) !==
        current.every((child) => Array.isArray(child)) ||
      new Set(childShapes).size > 1
    ) {
      throw new Error('Episode stats contain a ragged array');
    }
    current = current[0];
  }
  return shape;
}

function flatten(value: StatsArray): number[] {
  const result: number[] = [];
  const visit = (item: number | StatsArray): void => {
    if (typeof item === 'number') result.push(item);
    else item.forEach(visit);
  };
  visit(value);
  return result;
}

function reshape(values: readonly number[], shape: readonly number[]): StatsArray {
  let offset = 0;
  const build = (depth: number): StatsArray =>
    Array.from({ length: shape[depth] }, () =>
      depth === shape.length - 1 ? values[offset++] : build(depth + 1),
    );
  return build(0);
}

function channelLayout(
  shape: readonly number[],
  channels: number,
): 'cube' | 'first' | 'last' | null {
  if (shape.length === 1 && shape[0] === channels) return 'cube';
  if (shape.length === 3 && shape[0] === channels && shape[1] === 1 && shape[2] === 1)
    return 'cube';
  if (shape[0] === channels) return 'first';
  if (shape[shape.length - 1] === channels) return 'last';
  return null;
}

function reduceToChannels(
  values: readonly number[],
  shape: readonly number[],
  channels: number,
  reduce: 'min' | 'max' | 'mean' | 'std',
): number[] {
  const layout = channelLayout(shape, channels);
  if (!layout) {
    throw new Error(
      `Cannot map visual stats shape [${shape.join(',')}] onto ${channels} channel(s)`,
    );
  }
  if (layout === 'cube' || values.length === channels) return Array.from(values.slice(0, channels));
  const buckets = Array.from({ length: channels }, () => [] as number[]);
  if (layout === 'last') {
    for (let index = 0; index < values.length; index++) {
      buckets[index % channels].push(values[index]);
    }
  } else {
    const spatial = values.length / channels;
    for (let channel = 0; channel < channels; channel++) {
      for (let index = 0; index < spatial; index++) {
        buckets[channel].push(values[channel * spatial + index]);
      }
    }
  }
  return buckets.map((bucket) => {
    if (reduce === 'min') return Math.min(...bucket);
    if (reduce === 'max') return Math.max(...bucket);
    const mean = bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
    if (reduce === 'mean') return mean;
    return Math.sqrt(bucket.reduce((sum, value) => sum + (value - mean) ** 2, 0) / bucket.length);
  });
}

function visualChannelCube(values: readonly number[]): StatsArray {
  return values.map((value) => [[value]]);
}

/** Official datasets may persist spatial image stats and omit quantile keys. */
function coerceVisualStats(
  raw: Record<string, unknown>,
  featureKey: string,
  channels: number,
): FeatureStats {
  const count = plainArray(raw.count);
  if (!count || count.length !== 1 || typeof count[0] !== 'number' || count[0] <= 0) {
    throw new Error(
      `Cannot compute training-ready stats: invalid count for feature "${featureKey}"`,
    );
  }
  const required = ['min', 'max', 'mean', 'std'] as const;
  const arrays = {} as Record<(typeof required)[number], StatsArray>;
  for (const key of required) {
    const value = plainArray(raw[key]);
    if (!value) {
      throw new Error(
        `Cannot compute training-ready stats: missing or invalid "${key}" for feature "${featureKey}"`,
      );
    }
    arrays[key] = value;
  }
  const shape = shapeOf(arrays.mean);
  for (const key of required) {
    if (JSON.stringify(shapeOf(arrays[key])) !== JSON.stringify(shape)) {
      throw new Error(
        `Cannot compute training-ready stats: inconsistent shape for "${featureKey}"`,
      );
    }
  }
  const mean = reduceToChannels(flatten(arrays.mean), shape, channels, 'mean');
  const result = {
    min: visualChannelCube(reduceToChannels(flatten(arrays.min), shape, channels, 'min')),
    max: visualChannelCube(reduceToChannels(flatten(arrays.max), shape, channels, 'max')),
    mean: visualChannelCube(mean),
    std: visualChannelCube(reduceToChannels(flatten(arrays.std), shape, channels, 'std')),
    count: [count[0]],
  } as FeatureStats;
  for (const [key] of QUANTILES) {
    const value = plainArray(raw[key]);
    result[key] = value
      ? visualChannelCube(reduceToChannels(flatten(value), shapeOf(value), channels, 'mean'))
      : visualChannelCube(mean);
  }
  return result;
}

function validateStats(
  raw: Record<string, unknown>,
  featureKey: string,
  expectedShape?: readonly number[],
): FeatureStats {
  const count = plainArray(raw.count);
  if (!count || count.length !== 1 || typeof count[0] !== 'number' || count[0] <= 0) {
    throw new Error(
      `Cannot compute training-ready stats: invalid count for feature "${featureKey}"`,
    );
  }
  const result = { count: [count[0]] } as FeatureStats;
  let shape: number[] | undefined;
  for (const key of STAT_KEYS) {
    const value = plainArray(raw[key]);
    if (!value) {
      throw new Error(
        `Cannot compute training-ready stats: missing or invalid "${key}" for feature "${featureKey}"`,
      );
    }
    const valueShape = shapeOf(value);
    shape ??= valueShape;
    if (JSON.stringify(shape) !== JSON.stringify(valueShape)) {
      throw new Error(
        `Cannot compute training-ready stats: inconsistent shape for "${featureKey}"`,
      );
    }
    result[key] = value;
  }
  if (expectedShape && JSON.stringify(shape) !== JSON.stringify(expectedShape)) {
    throw new Error(
      `Cannot compute training-ready stats: feature "${featureKey}" has stats shape ` +
        `[${shape?.join(',')}] but official shape is [${expectedShape.join(',')}]`,
    );
  }
  return result;
}

function flattenedEpisodeStats(
  episode: EpisodeMetadata,
  featureKey: string,
): Record<string, unknown> | undefined {
  const nested = (episode as Record<string, unknown>).stats as
    Record<string, Record<string, unknown>> | undefined;
  if (nested?.[featureKey]) return nested[featureKey];
  const prefix = `stats/${featureKey}/`;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(episode)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function aggregateFeature(items: readonly FeatureStats[], featureKey: string): FeatureStats {
  if (items.length === 0) throw new Error(`No episode stats for feature "${featureKey}"`);
  const shape = shapeOf(items[0].mean);
  const width = flatten(items[0].mean).length;
  const counts = items.map((item) => item.count[0]);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const values = items.map((item) => {
    const output = {} as Record<(typeof STAT_KEYS)[number], number[]>;
    for (const key of STAT_KEYS) {
      if (JSON.stringify(shapeOf(item[key])) !== JSON.stringify(shape)) {
        throw new Error(`Incompatible episode stats shape for feature "${featureKey}"`);
      }
      output[key] = flatten(item[key]);
    }
    return output;
  });
  const mean = Array.from(
    { length: width },
    (_, dim) =>
      values.reduce((sum, value, index) => sum + value.mean[dim] * counts[index], 0) / total,
  );
  const variance = Array.from(
    { length: width },
    (_, dim) =>
      values.reduce((sum, value, index) => {
        const delta = value.mean[dim] - mean[dim];
        return sum + (value.std[dim] ** 2 + delta ** 2) * counts[index];
      }, 0) / total,
  );
  const result = {
    min: reshape(
      Array.from({ length: width }, (_, dim) => Math.min(...values.map((value) => value.min[dim]))),
      shape,
    ),
    max: reshape(
      Array.from({ length: width }, (_, dim) => Math.max(...values.map((value) => value.max[dim]))),
      shape,
    ),
    mean: reshape(mean, shape),
    std: reshape(
      variance.map((value) => Math.sqrt(Math.max(0, value))),
      shape,
    ),
    count: [total],
  } as FeatureStats;
  for (const [key] of QUANTILES) {
    result[key] = reshape(
      Array.from(
        { length: width },
        (_, dim) =>
          values.reduce((sum, value, index) => sum + value[key][dim] * counts[index], 0) / total,
      ),
      shape,
    );
  }
  return result;
}

function histogramQuantile(
  histogram: Uint32Array,
  low: number,
  high: number,
  target: number,
): number {
  let cumulative = 0;
  let before = 0;
  let index = 0;
  for (; index < histogram.length; index++) {
    before = cumulative;
    cumulative += histogram[index];
    if (cumulative >= target) break;
  }
  if (index === 0) return low;
  if (index >= histogram.length) return high;
  const countInBin = cumulative - before;
  const fraction = countInBin === 0 ? 0 : (target - before) / countInBin;
  return low + (index + fraction) * ((high - low) / histogram.length);
}

function computeNumericEpisode(
  count: number,
  dim: number,
  readRow: (row: number) => number[],
): FeatureStats {
  const min = new Array<number>(dim).fill(Infinity);
  const max = new Array<number>(dim).fill(-Infinity);
  const sum = new Array<number>(dim).fill(0);
  const squares = new Array<number>(dim).fill(0);
  for (let row = 0; row < count; row++) {
    const values = readRow(row);
    for (let d = 0; d < dim; d++) {
      const value = values[d];
      min[d] = Math.min(min[d], value);
      max[d] = Math.max(max[d], value);
      sum[d] += value;
      squares[d] += value * value;
    }
  }
  const mean = sum.map((value) => value / count);
  const std = squares.map((value, d) => Math.sqrt(Math.max(0, value / count - mean[d] * mean[d])));
  const result = { min, max, mean, std, count: [count] } as FeatureStats;
  if (count < 2) {
    for (const [key] of QUANTILES) result[key] = [...mean];
    return result;
  }
  const low = min.map((value, d) =>
    value === max[d] ? value - 1e-10 : value - (max[d] - value) * 1e-10,
  );
  const high = max.map((value, d) =>
    value === min[d] ? value + 1e-10 : value + (value - min[d]) * 1e-10,
  );
  const histograms = Array.from({ length: dim }, () => new Uint32Array(NUM_BINS));
  for (let row = 0; row < count; row++) {
    const values = readRow(row);
    for (let d = 0; d < dim; d++) {
      const scaled = ((values[d] - low[d]) / (high[d] - low[d])) * NUM_BINS;
      const index = Math.max(0, Math.min(NUM_BINS - 1, Math.floor(scaled)));
      histograms[d][index]++;
    }
  }
  for (const [key, quantile] of QUANTILES) {
    result[key] = histograms.map((histogram, d) =>
      histogramQuantile(histogram, low[d], high[d], quantile * count),
    );
  }
  return result;
}

/** Aggregate persisted episode stats with official count-weighted semantics. */
export function aggregateEpisodeStats(
  statsByEpisode: readonly Record<string, FeatureStats | Record<string, unknown>>[],
): DatasetStats {
  const result: DatasetStats = {};
  const featureKeys = new Set(statsByEpisode.flatMap((stats) => Object.keys(stats)));
  for (const featureKey of featureKeys) {
    result[featureKey] = aggregateFeature(
      statsByEpisode
        .map((stats) => stats[featureKey])
        .filter((stats): stats is FeatureStats | Record<string, unknown> => stats !== undefined)
        .map((stats) => validateStats(stats as Record<string, unknown>, featureKey)),
      featureKey,
    );
  }
  return result;
}

/**
 * Compute v0.6.1 training stats. Numeric data uses one bounded 5000-bin
 * histogram per feature/episode; visual data is aggregated from persisted
 * episode stats so media sampling is not silently changed.
 */
export async function computeDatasetStats(
  dataLoader: StatsDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  options?: ComputeDatasetStatsOptions,
): Promise<DatasetStats> {
  if (episodes.length === 0) {
    throw new Error('Cannot compute training-ready stats for a dataset with no episodes');
  }
  const numericKeys = Object.entries(info.features)
    .filter(([, feature]) => isNumeric(feature) && !isVisual(feature))
    .map(([key]) => key);
  const visualKeys = Object.entries(info.features)
    .filter(([, feature]) => isVisual(feature))
    .map(([key]) => key);
  if (numericKeys.length === 0 && visualKeys.length === 0) {
    throw new Error('Cannot compute training-ready stats: no trainable features are available');
  }

  const perFeature = new Map<string, FeatureStats[]>();
  let globalRow = 0;
  for (let episodePosition = 0; episodePosition < episodes.length; episodePosition++) {
    if (options?.signal?.aborted) {
      const error = new Error('Export cancelled');
      error.name = 'AbortError';
      throw error;
    }
    const episode = episodes[episodePosition];
    const supplied = await options?.getEpisodeStats?.(episode);
    for (const featureKey of visualKeys) {
      const feature = info.features[featureKey];
      const raw = supplied?.[featureKey] ?? flattenedEpisodeStats(episode, featureKey);
      if (!raw) {
        throw new Error(
          `Cannot compute training-ready stats: selected episode ${episode.episode_index} ` +
            `is missing required visual stats for feature "${featureKey}"`,
        );
      }
      const channels = visualChannels(feature);
      const stats = coerceVisualStats(raw as Record<string, unknown>, featureKey, channels);
      const list = perFeature.get(featureKey) ?? [];
      list.push(stats);
      perFeature.set(featureKey, list);
    }

    if (numericKeys.length > 0) {
      const { table } = await dataLoader.getEpisodeTableForExport(episode.episode_index);
      if (table.numRows === 0) {
        throw new Error(
          `Cannot compute training-ready stats: episode ${episode.episode_index} is empty`,
        );
      }
      if (table.numRows !== episode.length) {
        throw new Error(
          `Cannot compute training-ready stats: episode ${episode.episode_index} row count ` +
            `${table.numRows} does not match metadata length ${episode.length}`,
        );
      }
      for (const featureKey of numericKeys) {
        const vector = table.getChild(featureKey);
        if (!vector) {
          if (featureKey !== SUBTASK_INDEX_FEATURE_KEY || !options?.resolveNumericRow) {
            throw new Error(
              `Cannot compute training-ready stats: episode ${episode.episode_index} ` +
                `is missing feature "${featureKey}"`,
            );
          }
        }
        const dim = featureDim(info.features[featureKey]);
        const readRow = (row: number): number[] => {
          const sourceValues = vector ? numericRow(vector, row, dim) : [];
          if (!sourceValues) {
            throw new Error(
              `Cannot compute training-ready stats: feature "${featureKey}" has an invalid row`,
            );
          }
          const resolved = options?.resolveNumericRow?.(featureKey, {
            episode,
            outputEpisodeIndex: episodePosition,
            rowIndex: row,
            outputGlobalIndex: globalRow + row,
            sourceValues,
          });
          const values =
            resolved === undefined
              ? sourceValues
              : typeof resolved === 'number'
                ? [resolved]
                : Array.from(resolved);
          if (values.length !== dim || values.some((value) => !Number.isFinite(value))) {
            throw new Error(
              `Cannot compute training-ready stats: final value for "${featureKey}" is invalid`,
            );
          }
          return values;
        };
        const list = perFeature.get(featureKey) ?? [];
        list.push(computeNumericEpisode(table.numRows, dim, readRow));
        perFeature.set(featureKey, list);
      }
      globalRow += table.numRows;
    } else {
      globalRow += episode.length;
    }
    options?.onProgress?.(episodePosition + 1, episodes.length);
  }

  const result: DatasetStats = {};
  for (const [featureKey, values] of perFeature) {
    result[featureKey] = aggregateFeature(values, featureKey);
  }
  return result;
}
