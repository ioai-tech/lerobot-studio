import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import {
  computeDatasetStats,
  type DatasetStats,
  type EpisodeMetadata,
  type FeatureStats,
  type LeRobotInfo,
  type StatsArray,
} from '@/core';

const officialSource = '/tmp/lerobot-official-v061/src/lerobot/datasets/compute_stats.py';
const oracleScript = resolve('tests/helpers/officialStatsOracle.py');

const fixtures = {
  constant: [[[7], [7], [7]]],
  extremes: [[[-1_000_000], [0], [1_000_000], [3]]],
  episodes: [
    [[0], [10]],
    [[20], [30], [40]],
  ],
  vector: [
    [
      [0, 100],
      [10, 80],
      [20, 60],
    ],
    [
      [30, 40],
      [40, 20],
    ],
  ],
} satisfies Record<string, number[][][]>;

function infoFor(shape: number[]): LeRobotInfo {
  return {
    codebase_version: 'v3.0',
    robot_type: 'test',
    total_episodes: 1,
    total_frames: 1,
    total_tasks: 0,
    fps: 30,
    chunks_size: 1000,
    data_path: '',
    video_path: null,
    splits: { train: '0:1' },
    features: { feature: { dtype: 'float32', shape, names: null } },
  };
}

function asTable(rows: number[][]): arrow.Table {
  if (rows[0].length === 1) return arrow.tableFromArrays({ feature: rows.map((row) => row[0]) });
  return arrow.tableFromArrays({ feature: rows });
}

async function computeFixture(episodes: number[][][]): Promise<FeatureStats> {
  const tables = episodes.map(asTable);
  const metadata: EpisodeMetadata[] = episodes.map((rows, index) => ({
    episode_index: index,
    length: rows.length,
    tasks: [],
  }));
  const stats = await computeDatasetStats(
    { getEpisodeTableForExport: async (index) => ({ table: tables[index] }) },
    infoFor([episodes[0][0].length]),
    metadata,
  );
  return stats.feature;
}

function expectCloseArray(actual: StatsArray, expected: unknown, tolerance = 1e-5): void {
  expect(Array.isArray(expected)).toBe(true);
  const expectedArray = expected as unknown[];
  expect(actual).toHaveLength(expectedArray.length);
  actual.forEach((value, index) => {
    if (Array.isArray(value)) {
      expectCloseArray(value, expectedArray[index], tolerance);
    } else {
      expect(Math.abs(value - Number(expectedArray[index]))).toBeLessThanOrEqual(
        tolerance * Math.max(1, Math.abs(Number(expectedArray[index]))),
      );
    }
  });
}

describe('LeRobot v0.6.1 training statistics', () => {
  it.runIf(existsSync(officialSource))(
    'matches definitions executed from official compute_stats.py',
    async () => {
      const official = JSON.parse(
        execFileSync('uv', ['run', '--quiet', '--with', 'numpy', 'python3', oracleScript], {
          input: JSON.stringify(fixtures),
          encoding: 'utf8',
          env: { ...process.env, LEROBOT_V061_COMPUTE_STATS: officialSource },
        }),
      ) as Record<string, FeatureStats>;

      for (const [name, episodes] of Object.entries(fixtures)) {
        const actual = await computeFixture(episodes);
        for (const key of [
          'min',
          'max',
          'mean',
          'std',
          'q01',
          'q10',
          'q50',
          'q90',
          'q99',
        ] as const) {
          expectCloseArray(actual[key], official[name][key]);
        }
        expect(actual.count).toEqual(official[name].count);
      }
    },
    60_000,
  );

  it('preserves official visual JSON shape and episode weighting', async () => {
    const visualInfo = {
      ...infoFor([1]),
      features: {
        'observation.images.front': {
          dtype: 'video',
          shape: [3, 480, 640],
          names: null,
        },
      },
    } as LeRobotInfo;
    const visualStats = (mean: number[], count: number): FeatureStats => ({
      min: mean.map((value) => [[value - 1]]),
      max: mean.map((value) => [[value + 1]]),
      mean: mean.map((value) => [[value]]),
      std: mean.map(() => [[2]]),
      q01: mean.map((value) => [[value - 0.5]]),
      q10: mean.map((value) => [[value - 0.25]]),
      q50: mean.map((value) => [[value]]),
      q90: mean.map((value) => [[value + 0.25]]),
      q99: mean.map((value) => [[value + 0.5]]),
      count: [count],
    });
    const episodes = [
      {
        episode_index: 0,
        length: 2,
        tasks: [],
        stats: { 'observation.images.front': visualStats([1, 2, 3], 2) },
      },
      {
        episode_index: 1,
        length: 6,
        tasks: [],
        stats: { 'observation.images.front': visualStats([5, 6, 7], 6) },
      },
    ];
    const stats = await computeDatasetStats(
      { getEpisodeTableForExport: async () => ({ table: arrow.tableFromArrays({}) }) },
      visualInfo,
      episodes,
    );

    expect(stats['observation.images.front'].mean).toEqual([[[4]], [[5]], [[6]]]);
    expect(stats['observation.images.front'].q50).toEqual([[[4]], [[5]], [[6]]]);
    expect(stats['observation.images.front'].count).toEqual([8]);
  });

  it('rejects a selected episode with missing visual stats', async () => {
    const visualInfo = {
      ...infoFor([1]),
      features: {
        'observation.depth': { dtype: 'depth', shape: [1, 10, 10], names: null },
      },
    } as LeRobotInfo;
    await expect(
      computeDatasetStats(
        { getEpisodeTableForExport: async () => ({ table: arrow.tableFromArrays({}) }) },
        visualInfo,
        [{ episode_index: 7, length: 1, tasks: [] }],
      ),
    ).rejects.toThrow(/episode 7.*missing required visual stats.*observation\.depth/);
  });

  it('computes bookkeeping stats from final export semantics through the resolver API', async () => {
    const bookkeepingInfo = {
      ...infoFor([1]),
      features: {
        index: { dtype: 'int64', shape: [1], names: null },
        episode_index: { dtype: 'int64', shape: [1], names: null },
        task_index: { dtype: 'int64', shape: [1], names: null },
      },
    } as LeRobotInfo;
    const tables = [
      arrow.tableFromArrays({ index: [99, 100], episode_index: [4, 4], task_index: [8, 8] }),
      arrow.tableFromArrays({ index: [3], episode_index: [9], task_index: [2] }),
    ];
    const stats: DatasetStats = await computeDatasetStats(
      { getEpisodeTableForExport: async (index) => ({ table: tables[index === 4 ? 0 : 1] }) },
      bookkeepingInfo,
      [
        { episode_index: 4, length: 2, tasks: [] },
        { episode_index: 9, length: 1, tasks: [] },
      ],
      {
        resolveNumericRow: (key, context) => {
          if (key === 'index') return context.outputGlobalIndex;
          if (key === 'episode_index') return context.outputEpisodeIndex;
          if (key === 'task_index') return context.outputEpisodeIndex === 0 ? 5 : 6;
          return undefined;
        },
      },
    );

    expect(stats.index.min).toEqual([0]);
    expect(stats.index.max).toEqual([2]);
    expect(stats.episode_index.mean).toEqual([1 / 3]);
    expect(stats.task_index.mean).toEqual([16 / 3]);
  });
});
