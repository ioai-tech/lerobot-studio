import { describe, expect, it } from 'vitest';
import { isDepthMapFeature, type LeRobotFeature, type LeRobotInfo } from '../src/core';
import { computeDatasetStats } from '../src/core/analysis/StatsService';
import { computeTrimVisualStats } from '../src/platform/export/TrimVisualStats';
import type { ExportDataLoader } from '../src/platform/export/SegmentExportPlan';

const video = (extra: Record<string, unknown>): LeRobotFeature =>
  ({
    dtype: 'video',
    shape: [480, 640, 3],
    names: ['height', 'width', 'channels'],
    ...extra,
  }) as LeRobotFeature;

describe('isDepthMapFeature: every place LeRobot flags a depth map counts', () => {
  it.each([
    ['info.is_depth_map (current datasets)', { info: { is_depth_map: true } }],
    [
      'info["video.is_depth_map"] (legacy key under info)',
      { info: { 'video.is_depth_map': true } },
    ],
    [
      'video_info["video.is_depth_map"] (LeRobot v2.1 and older Hub datasets)',
      { video_info: { 'video.fps': 15, 'video.is_depth_map': true } },
    ],
  ])('%s', (_name, extra) => {
    expect(isDepthMapFeature(video(extra))).toBe(true);
  });

  it('a camera flagged false (or not at all) under any key is not a depth map', () => {
    expect(isDepthMapFeature(video({}))).toBe(false);
    expect(isDepthMapFeature(video({ info: { is_depth_map: false } }))).toBe(false);
    expect(isDepthMapFeature(video({ info: { 'video.is_depth_map': false } }))).toBe(false);
    expect(isDepthMapFeature(video({ video_info: { 'video.is_depth_map': false } }))).toBe(false);
    expect(isDepthMapFeature(undefined)).toBe(false);
  });

  it('any one flag counts, as in LeRobot (a false under info does not hide a true under video_info)', () => {
    expect(
      isDepthMapFeature(
        video({ info: { is_depth_map: false }, video_info: { 'video.is_depth_map': true } }),
      ),
    ).toBe(true);
  });

  it('dtype depth is a depth map', () => {
    expect(isDepthMapFeature({ dtype: 'depth' })).toBe(true);
  });
});

describe('depth flagged under video_info reaches the stats and trim readers', () => {
  const info = (feature: LeRobotFeature) =>
    ({
      codebase_version: 'v2.1',
      fps: 10,
      features: {
        'observation.state': { dtype: 'float32', shape: [1], names: ['joint1'] },
        'observation.images.depth': feature,
      },
    }) as unknown as LeRobotInfo;

  it('trimming a depth camera declared under video_info is refused by name, as under info', async () => {
    const loader = {} as ExportDataLoader;
    for (const extra of [
      { video_info: { 'video.is_depth_map': true } },
      { info: { 'video.is_depth_map': true } },
      { info: { is_depth_map: true } },
    ]) {
      await expect(
        computeTrimVisualStats(loader, info(video(extra)), 0, { startFrame: 0, endFrame: 1 }),
      ).rejects.toThrow('Cannot trim depth feature "observation.images.depth"');
    }
  });

  it('a uint16 depth column flagged under video_info is a visual feature, not a numeric one', async () => {
    const feature = {
      dtype: 'uint16',
      shape: [4, 4, 1],
      names: ['height', 'width', 'channels'],
      video_info: { 'video.is_depth_map': true },
    } as unknown as LeRobotFeature;
    // A visual feature needs its per-episode visual stats; a numeric one is read from the table.
    await expect(
      computeDatasetStats(
        {
          getEpisodeTableForExport: async () => {
            throw new Error('read as a numeric column');
          },
        },
        info(feature),
        [{ episode_index: 0, length: 2, tasks: ['pick'] }] as never,
        { getEpisodeStats: async () => ({}) },
      ),
    ).rejects.toThrow('missing required visual stats for feature "observation.images.depth"');
  });
});
