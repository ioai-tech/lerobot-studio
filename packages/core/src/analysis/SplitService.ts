import type { EpisodeMetadata } from '../types/lerobot';

/** Strategy for splitting episodes into train/val/test. */
export type SplitStrategy = 'random' | 'stratified' | 'range';

/** Configuration for reproducible splits. */
export interface SplitConfig {
  strategy: SplitStrategy;
  /** Random seed for random/stratified. Ignored for range. */
  seed?: number;
  /** Fraction for train (e.g. 0.8). Default 0.8. */
  trainRatio?: number;
  /** Fraction for val (e.g. 0.1). Default 0.1. */
  valRatio?: number;
  /** Fraction for test (e.g. 0.1). Default 0.1. */
  testRatio?: number;
  /** For strategy 'range': [start, end) episode indices (0-based, in export order). */
  ranges?: {
    train?: [number, number];
    val?: [number, number];
    test?: [number, number];
  };
}

/** Map split name -> episode indices (0-based in export order). */
export type SplitsIndices = Record<string, number[]>;

/** Serialize splits to LeRobot v3 info.splits format: each value is comma-separated indices. */
export function splitsIndicesToInfoSplits(splits: SplitsIndices): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, indices] of Object.entries(splits)) {
    if (indices.length > 0) {
      out[name] = indices.join(',');
    }
  }
  return out;
}

/** Seeded shuffle (Fisher–Yates) of indices 0..n-1. */
function shuffleIndices(n: number, seed: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  const rng = seededRandom(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fff_ffff;
    return s / 0x7fff_ffff;
  };
}

/**
 * Compute train/val/test splits over export episode indices [0, episodes.length).
 * Episodes are in export order; returned indices are 0-based in that order.
 */
export function computeSplits(episodes: EpisodeMetadata[], config: SplitConfig): SplitsIndices {
  const n = episodes.length;
  const trainR = config.trainRatio ?? 0.8;
  const valR = config.valRatio ?? 0.1;

  if (config.strategy === 'range') {
    const ranges = config.ranges ?? {};
    const out: SplitsIndices = { train: [], val: [], test: [] };
    const add = (key: 'train' | 'val' | 'test', [start, end]: [number, number]) => {
      for (let i = Math.max(0, start); i < Math.min(n, end); i++) {
        out[key].push(i);
      }
    };
    if (ranges.train) add('train', ranges.train);
    if (ranges.val) add('val', ranges.val);
    if (ranges.test) add('test', ranges.test);
    return out;
  }

  if (config.strategy === 'stratified') {
    const seed = config.seed ?? 0;
    const byTask = new Map<number, number[]>();
    episodes.forEach((ep, i) => {
      const taskIndex = ep.task_index ?? 0;
      if (!byTask.has(taskIndex)) byTask.set(taskIndex, []);
      byTask.get(taskIndex)!.push(i);
    });
    const train: number[] = [];
    const val: number[] = [];
    const test: number[] = [];
    for (const indices of byTask.values()) {
      const shuffled = shuffleIndices(indices.length, seed + indices[0]);
      const order = shuffled.map((j) => indices[j]);
      const nTrain = Math.round(order.length * trainR);
      const nVal = Math.round(order.length * valR);
      const nTest = order.length - nTrain - nVal;
      for (let i = 0; i < nTrain; i++) train.push(order[i]);
      for (let i = nTrain; i < nTrain + nVal; i++) val.push(order[i]);
      for (let i = nTrain + nVal; i < nTrain + nVal + nTest; i++) test.push(order[i]);
    }
    train.sort((a, b) => a - b);
    val.sort((a, b) => a - b);
    test.sort((a, b) => a - b);
    return { train, val, test };
  }

  // random
  const seed = config.seed ?? 0;
  const order = shuffleIndices(n, seed);
  const nTrain = Math.round(n * trainR);
  const nVal = Math.round(n * valR);
  const train = order.slice(0, nTrain).sort((a, b) => a - b);
  const val = order.slice(nTrain, nTrain + nVal).sort((a, b) => a - b);
  const test = order.slice(nTrain + nVal).sort((a, b) => a - b);
  return { train, val, test };
}
