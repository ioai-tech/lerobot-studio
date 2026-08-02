import { describe, expect, it } from 'vitest';
import { buildMediaDebugMetadata } from '@ioai/lerobot-studio-core';
import type { LeRobotInfo } from '@ioai/lerobot-studio-core';

describe('buildMediaDebugMetadata', () => {
  it('prefers runtime dimensions and feature-level fps metadata', () => {
    const info = {
      codebase_version: 'v3.0',
      robot_type: 'test_bot',
      total_episodes: 1,
      total_frames: 10,
      total_tasks: 1,
      fps: 24,
      chunks_size: 1000,
      splits: { train: '0:1' },
      data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
      video_path: 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4',
      features: {
        'observation.images.cam': {
          dtype: 'video',
          shape: [480, 640, 3],
          names: ['height', 'width', 'channel'],
          fps: 60,
          info: {
            'video.width': 640,
            'video.height': 480,
            'video.codec': 'h264',
            'video.pix_fmt': 'yuv420p',
            'video.fps': 30,
            'video.channels': 3,
            has_audio: false,
          },
        },
      },
    } satisfies LeRobotInfo;

    const metadata = buildMediaDebugMetadata(info, 'observation.images.cam', {
      runtimeDimensions: {
        width: 1920,
        height: 1080,
      },
      timeline: {
        startSec: 1.25,
        endSec: 3.5,
      },
    });

    expect(metadata).toMatchObject({
      dtype: 'video',
      shapeText: '[480, 640, 3]',
      fps: 60,
      width: 1920,
      height: 1080,
      codec: 'h264',
      pixelFormat: 'yuv420p',
      channels: 3,
      hasAudio: false,
      timeline: {
        startSec: 1.25,
        endSec: 3.5,
      },
    });
  });

  it('falls back to inferred shape resolution and dataset fps', () => {
    const info = {
      codebase_version: 'v2.1',
      robot_type: 'test_bot',
      total_episodes: 1,
      total_frames: 10,
      total_tasks: 1,
      fps: 25,
      chunks_size: 1000,
      data_path: 'data/chunk-{chunk_index:03d}/episode_{episode_index:06d}.parquet',
      video_path: 'videos/chunk-{chunk_index:03d}/{video_key}/episode_{episode_index:06d}.mp4',
      features: {
        'observation.images.hand': {
          dtype: 'image',
          shape: [3, 224, 224],
          names: ['channel', 'height', 'width'],
          info: {},
        },
      },
    } satisfies LeRobotInfo;

    const metadata = buildMediaDebugMetadata(info, 'observation.images.hand');

    expect(metadata).toMatchObject({
      dtype: 'image',
      fps: 25,
      width: 224,
      height: 224,
      channels: 3,
    });
  });

  it('returns null for missing features', () => {
    const info = {
      codebase_version: 'v2.1',
      robot_type: 'test_bot',
      total_episodes: 1,
      total_frames: 10,
      total_tasks: 1,
      fps: 25,
      chunks_size: 1000,
      data_path: 'data/chunk-{chunk_index:03d}/episode_{episode_index:06d}.parquet',
      video_path: 'videos/chunk-{chunk_index:03d}/{video_key}/episode_{episode_index:06d}.mp4',
      features: {},
    } satisfies LeRobotInfo;

    expect(buildMediaDebugMetadata(info, 'missing.feature')).toBeNull();
  });
});
