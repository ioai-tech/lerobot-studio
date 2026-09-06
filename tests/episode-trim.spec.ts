import { describe, expect, it } from 'vitest';
import * as arrow from 'apache-arrow';
import { validateEpisodeTrim, trimSubtaskSegments, type EpisodeMetadata } from '@/core';
import { buildTrimExportPlan } from '../src/platform/export/TrimExportPlan';
import { buildExportSubtaskPlan } from '../src/platform/export/SubtaskExportPlan';
import type { LeRobotDataLoader } from '@/platform';

describe('episode trimming', () => {
  it('rejects empty, reversed, fractional and out-of-bounds ranges', () => {
    for (const [startFrame, endFrame] of [
      [-1, 3],
      [2, 1],
      [0, 5],
      [1.5, 3],
      [0, NaN],
    ]) {
      expect(() => validateEpisodeTrim({ startFrame, endFrame }, 5)).toThrow();
    }
    expect(() => validateEpisodeTrim({ startFrame: 0, endFrame: 0 }, 0)).toThrow();
    expect(() => validateEpisodeTrim({ startFrame: 2, endFrame: 2 }, 5)).not.toThrow();
  });

  it('clips labels and validates coverage only inside the retained range', async () => {
    const range = { startFrame: 2, endFrame: 5 };
    const segments = [
      { startFrame: 1, endFrame: 3, label: 'pick' },
      { startFrame: 4, endFrame: 7, label: 'place' },
    ];
    expect(trimSubtaskSegments(segments, range)).toEqual([
      { startFrame: 0, endFrame: 1, label: 'pick' },
      { startFrame: 2, endFrame: 3, label: 'place' },
    ]);
    const plan = await buildExportSubtaskPlan({
      dataLoader: {} as LeRobotDataLoader,
      info: { features: {} } as any,
      episodes: [{ episode_index: 9, length: 4, tasks: ['test'] }],
      overlay: new Map([[9, segments]]),
      sourceTable: {},
      targetVersion: 'v3.0',
      trimRanges: new Map([[9, range]]),
    });
    expect(plan?.framesBySourceEpisode.get(9)).toEqual([0, 0, 1, 1]);
  });

  it('keeps source coordinates immutable and rebases only the selected rows', async () => {
    const table = new arrow.Table({
      timestamp: arrow.vectorFromArray([0, 0.1, 0.2, 0.3, 0.4], new arrow.Float32()),
      frame_index: arrow.vectorFromArray([0n, 1n, 2n, 3n, 4n], new arrow.Int64()),
      action: arrow.vectorFromArray([10, 11, 12, 13, 14], new arrow.Float32()),
    });
    const loader = {
      getEpisodeTableForExport: async () => ({ table, pathHint: 'source.parquet' }),
    } as LeRobotDataLoader;
    const episodes: EpisodeMetadata[] = [{ episode_index: 9, length: 5, tasks: ['test'] }];
    const plan = await buildTrimExportPlan(
      loader,
      episodes,
      new Map([[9, { startFrame: 2, endFrame: 3 }]]),
      10,
    );
    const output = (await plan.dataLoader.getEpisodeTableForExport(9)).table;
    expect(Array.from(output.getChild('action')!.toArray())).toEqual([12, 13]);
    expect(Array.from(output.getChild('frame_index')!.toArray())).toEqual([0n, 1n]);
    expect(Number(output.getChild('timestamp')!.get(0))).toBe(0);
    expect(Number(output.getChild('timestamp')!.get(1))).toBeCloseTo(0.1);
    expect(plan.episodes[0].length).toBe(2);
    expect(episodes[0].length).toBe(5);
    expect(table.numRows).toBe(5);
    expect(plan.ranges.get(9)).toMatchObject({ fromSec: 0.2, toSec: 0.4 });
    expect(
      (
        await buildTrimExportPlan(
          loader,
          episodes,
          new Map([[9, { startFrame: 0, endFrame: 4 }]]),
          10,
        )
      ).ranges.size,
    ).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildTrimExportPlan(loader, episodes, new Map(), 10, controller.signal),
    ).rejects.toThrow();
  });
});
