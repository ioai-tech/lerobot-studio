import { describe, expect, it } from 'vitest';
import { formatLeRobotPath } from '@ioai/lerobot-studio-core';

describe('formatLeRobotPath', () => {
  it('formats official v2 episode and video templates', () => {
    expect(
      formatLeRobotPath('data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet', {
        episode_chunk: 2,
        episode_index: 42,
      }),
    ).toBe('data/chunk-002/episode_000042.parquet');

    expect(
      formatLeRobotPath(
        'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4',
        {
          episode_chunk: 2,
          episode_index: 42,
          video_key: 'observation.images.wrist',
        },
      ),
    ).toBe('videos/chunk-002/observation.images.wrist/episode_000042.mp4');
  });

  it('formats official v3 templates and rejects missing variables', () => {
    expect(
      formatLeRobotPath('videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4', {
        video_key: 'observation.images.cam',
        chunk_index: 1,
        file_index: 7,
      }),
    ).toBe('videos/observation.images.cam/chunk-001/file-007.mp4');

    expect(() =>
      formatLeRobotPath('data/{chunk_index:03d}/{file_index:03d}', { chunk_index: 0 }),
    ).toThrow('file_index');
  });
});
