import { describe, expect, it } from 'vitest';
import {
  buildPlaybackFrames,
  getEagerEpisodeColumns,
  getFirstAvailableEpisodeIndex,
} from '@ioai/lerobot-studio-core';
import type { NumericalColumnMap } from '@ioai/lerobot-studio-platform';
import type { EpisodeMetadata, LeRobotInfo } from '@ioai/lerobot-studio-core';

const info = {
  codebase_version: 'v2.1',
  robot_type: 'test-bot',
  total_episodes: 1,
  total_frames: 3,
  total_tasks: 1,
  total_videos: 0,
  total_chunks: 1,
  chunks_size: 1000,
  fps: 30,
  features: {
    timestamp: { dtype: 'float32', shape: [1], names: null },
    'observation.joint': { dtype: 'float32', shape: [2], names: null },
    'observation.caption': { dtype: 'string', shape: [1], names: null },
    'observation.image': { dtype: 'image', shape: [1], names: null },
    frame_index: { dtype: 'int64', shape: [1], names: null },
  },
} as unknown as LeRobotInfo;

describe('episode load plan helpers', () => {
  it('only preloads timeline and numerical columns', () => {
    expect(getEagerEpisodeColumns(info)).toEqual(['timestamp', 'observation.joint']);
  });

  it('builds lightweight playback frames from timestamp data', () => {
    const columnData: NumericalColumnMap = {
      timestamp: { values: Float64Array.from([0, 0.5, 1]), rows: 3, width: 1 },
      'observation.joint': { values: Float64Array.from([1, 2, 3, 4, 5, 6]), rows: 3, width: 2 },
    };

    expect(buildPlaybackFrames(columnData, 30)).toEqual([
      { frame_index: 0, timestamp: 0 },
      { frame_index: 1, timestamp: 0.5 },
      { frame_index: 2, timestamp: 1 },
    ]);
  });

  it('falls back to fps-derived timestamps when timestamp column is absent', () => {
    expect(
      buildPlaybackFrames(
        {
          'observation.joint': { values: Float64Array.from([1, 2, 3]), rows: 3, width: 1 },
        },
        2,
      ),
    ).toEqual([
      { frame_index: 0, timestamp: 0 },
      { frame_index: 1, timestamp: 0.5 },
      { frame_index: 2, timestamp: 1 },
    ]);
  });

  it('picks the first non-deleted episode for auto selection', () => {
    const episodes = [
      { episode_index: 0, length: 10, tasks: [] },
      { episode_index: 1, length: 12, tasks: [] },
      { episode_index: 2, length: 8, tasks: [] },
    ] as EpisodeMetadata[];

    expect(getFirstAvailableEpisodeIndex(episodes, new Set([0, 1]))).toBe(2);
    expect(getFirstAvailableEpisodeIndex(episodes, new Set([0, 1, 2]))).toBeNull();
  });
});
