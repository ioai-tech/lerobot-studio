import type { Table } from 'apache-arrow';
import type { LeRobotInfo, EpisodeMetadata, LeRobotFeature } from '../types/lerobot';

/** Duck-typed loader surface used for export/stats aggregation. */
export interface StatsDataLoader {
  getEpisodeTableForExport(episodeIndex: number): Promise<{ table: Table }>;
}

/** Per-feature stats: arrays have one value per dimension (or length 1 for scalar). */
export interface FeatureStats {
  min: number[];
  max: number[];
  mean: number[];
  std: number[];
  count: number;
}

export type DatasetStats = Record<string, FeatureStats>;

function isNumericDtype(dtype: string | undefined): boolean {
  if (!dtype) return false;
  const d = dtype.toLowerCase();
  return d.includes('float') || d.includes('int') || d === 'int64' || d === 'float32';
}

/** Extract numeric feature keys from info that exist in the table schema. */
function getNumericFeatureKeys(info: LeRobotInfo, table: Table): string[] {
  const keys: string[] = [];
  for (const [key, feature] of Object.entries(info.features || {})) {
    if (!feature || !isNumericDtype(feature.dtype)) continue;
    if (!table.schema.fields.some((f) => f.name === key)) continue;
    keys.push(key);
  }
  return keys;
}

/** Get dimension for a feature (number of scalar values per row). */
function getFeatureDim(feature: LeRobotFeature): number {
  const shape = feature.shape;
  if (shape && shape.length > 0 && typeof shape[0] === 'number') return shape[0];
  return 1;
}

/** Read a numeric value from Arrow (scalar or list) as number[]. */
function getNumericRow(
  vector: ReturnType<Table['getChild']>,
  row: number,
  dim: number,
): number[] | null {
  const val = vector?.get(row);
  if (val === undefined || val === null) return null;
  if (typeof val === 'number' && !Number.isNaN(val)) return [val];
  if (typeof val === 'bigint') return [Number(val)];
  if (Array.isArray(val)) {
    const out = val.slice(0, dim).map((v) => (typeof v === 'bigint' ? Number(v) : Number(v)));
    if (out.some((v) => Number.isNaN(v))) return null;
    return out;
  }
  const obj = val as { toArray?: () => number[]; length?: number };
  if (typeof obj.toArray === 'function') {
    const arr = obj.toArray().slice(0, dim);
    if (arr.some((v) => Number.isNaN(v))) return null;
    return arr;
  }
  return null;
}

/** Running stats accumulator per dimension (Welford-friendly: n, mean, m2, min, max). */
function createAccum(dim: number): {
  n: number;
  mean: number[];
  m2: number[];
  min: number[];
  max: number[];
} {
  return {
    n: 0,
    mean: new Array(dim).fill(0),
    m2: new Array(dim).fill(0),
    min: new Array(dim).fill(Number.POSITIVE_INFINITY),
    max: new Array(dim).fill(Number.NEGATIVE_INFINITY),
  };
}

function updateAccum(acc: ReturnType<typeof createAccum>, values: number[]): void {
  const dim = values.length;
  acc.n += 1;
  const n = acc.n;
  for (let d = 0; d < dim; d++) {
    const x = values[d];
    if (Number.isNaN(x) || !Number.isFinite(x)) continue;
    const delta = x - acc.mean[d];
    acc.mean[d] += delta / n;
    acc.m2[d] += delta * (x - acc.mean[d]);
    if (x < acc.min[d]) acc.min[d] = x;
    if (x > acc.max[d]) acc.max[d] = x;
  }
}

function toFeatureStats(acc: ReturnType<typeof createAccum>, dim: number): FeatureStats {
  const mean = acc.mean.slice(0, dim);
  const std = new Array(dim).fill(0);
  for (let d = 0; d < dim; d++) {
    if (acc.n > 0) {
      const variance = acc.m2[d] / acc.n;
      std[d] = Math.sqrt(variance);
    }
  }
  const min = acc.min.slice(0, dim).map((v) => (v === Number.POSITIVE_INFINITY ? 0 : v));
  const max = acc.max.slice(0, dim).map((v) => (v === Number.NEGATIVE_INFINITY ? 0 : v));
  return { min, max, mean, std, count: acc.n };
}

/**
 * Compute global numeric feature statistics (min, max, mean, std) over all episodes.
 * Streams episode tables and aggregates; reports progress and respects AbortSignal.
 */
export async function computeDatasetStats(
  dataLoader: StatsDataLoader,
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  options?: { onProgress?: (current: number, total: number) => void; signal?: AbortSignal },
): Promise<DatasetStats> {
  const result: DatasetStats = {};
  const numericKeys = new Set<string>();
  const dims: Record<string, number> = {};
  const accums: Record<string, ReturnType<typeof createAccum>> = {};
  const total = episodes.length;
  const progressInterval = Math.max(1, Math.floor(total / 50));

  for (let i = 0; i < episodes.length; i++) {
    if (options?.signal?.aborted) {
      const err = new Error('Export cancelled');
      err.name = 'AbortError';
      throw err;
    }
    if (i > 0 && i % progressInterval === 0) {
      options?.onProgress?.(i, total);
    }

    const ep = episodes[i];
    const { table } = await dataLoader.getEpisodeTableForExport(ep.episode_index);

    if (i === 0) {
      for (const key of getNumericFeatureKeys(info, table)) {
        numericKeys.add(key);
        const feat = info.features[key];
        const dim = feat ? getFeatureDim(feat) : 1;
        dims[key] = dim;
        accums[key] = createAccum(dim);
      }
    }

    for (const key of numericKeys) {
      const vector = table.getChild(key);
      if (!vector) continue;
      const dim = dims[key] ?? 1;
      const accum = accums[key];
      for (let row = 0; row < table.numRows; row++) {
        const values = getNumericRow(vector, row, dim);
        if (values) updateAccum(accum, values);
      }
    }
  }

  options?.onProgress?.(total, total);

  for (const key of numericKeys) {
    const dim = dims[key] ?? 1;
    result[key] = toFeatureStats(accums[key], dim);
  }

  return result;
}
