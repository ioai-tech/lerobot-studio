import { describe, expect, it } from 'vitest';
import { computeSplits, splitsIndicesToInfoSplits } from '../src/core/analysis/SplitService';
import type { EpisodeMetadata } from '../src/core/types/lerobot';

describe('LeRobot v3 split serialization', () => {
  it('writes official half-open start:end ranges for contiguous splits', () => {
    expect(
      splitsIndicesToInfoSplits({
        train: [0, 1, 2],
        val: [3, 4],
        test: [],
      }),
    ).toEqual({
      train: '0:3',
      val: '3:5',
    });
  });

  it('rejects non-contiguous random assignments instead of writing comma indices', () => {
    expect(() =>
      splitsIndicesToInfoSplits({
        train: [0, 2, 3],
        val: [1],
      }),
    ).toThrow(/train.*not contiguous.*Reorder episodes by split or use range splits/i);
  });

  it.each([[-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]])(
    'rejects invalid episode index %s',
    (invalidIndex) => {
      expect(() => splitsIndicesToInfoSplits({ train: [invalidIndex] })).toThrow(
        /non-negative safe integer/i,
      );
    },
  );

  it('serializes range strategy output without changing its boundaries', () => {
    const episodes = Array.from(
      { length: 6 },
      (_, episode_index) =>
        ({
          episode_index,
          length: 1,
          tasks: [],
        }) as EpisodeMetadata,
    );
    const indices = computeSplits(episodes, {
      strategy: 'range',
      ranges: {
        train: [0, 4],
        val: [4, 6],
      },
    });

    expect(splitsIndicesToInfoSplits(indices)).toEqual({
      train: '0:4',
      val: '4:6',
    });
  });
});

function makeEpisodes(taskIndices: Array<number | undefined>): EpisodeMetadata[] {
  return taskIndices.map(
    (task_index, episode_index) =>
      ({
        episode_index,
        length: 1,
        tasks: [],
        task_index,
      }) as EpisodeMetadata,
  );
}

describe('computeSplits', () => {
  it('clamps range boundaries and keeps missing ranges empty', () => {
    expect(
      computeSplits(makeEpisodes([0, 0, 0, 0]), {
        strategy: 'range',
        ranges: { train: [-2, 2], test: [3, 10] },
      }),
    ).toEqual({ train: [0, 1], val: [], test: [3] });
  });

  it('uses deterministic seeded random splits with default ratios', () => {
    const episodes = makeEpisodes(Array.from({ length: 10 }, () => 0));
    const first = computeSplits(episodes, { strategy: 'random', seed: 42 });
    const second = computeSplits(episodes, { strategy: 'random', seed: 42 });

    expect(first).toEqual(second);
    expect(first.train).toHaveLength(8);
    expect(first.val).toHaveLength(1);
    expect(first.test).toHaveLength(1);
    expect([...first.train, ...first.val, ...first.test].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, index) => index),
    );
  });

  it('stratifies each task independently and treats missing task indices as task zero', () => {
    const episodes = makeEpisodes([undefined, 0, 0, 1, 1, 1]);
    const result = computeSplits(episodes, {
      strategy: 'stratified',
      seed: 7,
      trainRatio: 0.5,
      valRatio: 0,
    });

    expect(result.train).toHaveLength(4);
    expect(result.val).toEqual([]);
    expect(result.test).toHaveLength(2);
    expect(result.train).toEqual([...result.train].sort((a, b) => a - b));
    expect([...result.train, ...result.test].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.train.filter((index) => index <= 2)).toHaveLength(2);
    expect(result.train.filter((index) => index >= 3)).toHaveLength(2);
  });
});
