import { describe, expect, it, vi } from 'vitest';
import type { DataSource, LeRobotInfo } from '@/core';
import {
  clampV2EpisodesToExisting,
  findExistingV2Episodes,
  hasBlockingValidationError,
  V2Adapter,
  V2FormatValidator,
} from '@/core';

vi.mock('../src/platform/workers/workerManager.ts', () => ({
  createParquetWorker: () => ({
    clearCache: async () => undefined,
  }),
  terminateWorker: () => undefined,
}));

import { LeRobotDataLoader } from '@/platform';

const PARTIAL_INFO: LeRobotInfo = {
  codebase_version: 'v2.1',
  robot_type: 'test_so100',
  total_episodes: 3,
  total_frames: 9,
  total_tasks: 1,
  chunks_size: 1000,
  fps: 10,
  data_path: 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet',
  video_path: 'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4',
  features: {
    'observation.state': {
      dtype: 'float32',
      shape: [1],
      names: ['joint1'],
    },
    timestamp: { dtype: 'float32', shape: [1], names: null },
    episode_index: { dtype: 'int64', shape: [1], names: null },
    frame_index: { dtype: 'int64', shape: [1], names: null },
    index: { dtype: 'int64', shape: [1], names: null },
    task_index: { dtype: 'int64', shape: [1], names: null },
  },
};

const EPISODES_JSONL = [
  '{"episode_index":0,"length":3,"tasks":["pick cube"]}',
  '{"episode_index":1,"length":3,"tasks":["pick cube"]}',
  '{"episode_index":2,"length":3,"tasks":["pick cube"]}',
].join('\n');

function memorySource(files: Record<string, string>): DataSource {
  return {
    async exists(path: string) {
      return Object.hasOwn(files, path);
    },
    async readText(path: string) {
      if (!Object.hasOwn(files, path)) throw new Error(`missing ${path}`);
      return files[path];
    },
    async readBytes(path: string) {
      if (!Object.hasOwn(files, path)) throw new Error(`missing ${path}`);
      return new TextEncoder().encode(files[path]);
    },
    async getObjectUrl() {
      return 'blob:test';
    },
    clear() {},
  };
}

function partialFiles(): Record<string, string> {
  return {
    'meta/info.json': JSON.stringify(PARTIAL_INFO),
    'meta/episodes.jsonl': EPISODES_JSONL,
    'meta/tasks.jsonl': '{"task_index":0,"task":"pick cube"}',
    'data/chunk-000/episode_000000.parquet': 'parquet',
  };
}

describe('v2 partial episode files', () => {
  it('still treats structural errors as blocking when episodes are also missing', () => {
    expect(
      hasBlockingValidationError({
        hasError: true,
        hasWarning: false,
        items: [
          { level: 'error', code: 'EPISODE_DATA_MISSING', message: '2 of 3 missing' },
          { level: 'error', code: 'INFO_MISSING', message: 'meta/info.json missing' },
        ],
      }),
    ).toBe(true);
  });

  it('reports EPISODE_DATA_MISSING as a non-blocking error', async () => {
    const source = memorySource(partialFiles());
    const report = await new V2FormatValidator().validate(source, PARTIAL_INFO);
    expect(report.hasError).toBe(true);
    expect(report.items.some((item) => item.code === 'EPISODE_DATA_MISSING')).toBe(true);
    expect(hasBlockingValidationError(report)).toBe(false);
  });

  it('clamps loadEpisodes to parquet files that exist', async () => {
    const source = memorySource(partialFiles());
    const episodes = await new V2Adapter().loadEpisodes(
      source,
      { readParquetToIPC: async () => new Uint8Array() },
      PARTIAL_INFO,
    );
    expect(episodes.map((episode) => episode.episode_index)).toEqual([0]);
  });

  it('keeps the meta list when no parquet files exist', async () => {
    const presence = await findExistingV2Episodes(
      memorySource({
        'meta/info.json': JSON.stringify(PARTIAL_INFO),
        'meta/episodes.jsonl': EPISODES_JSONL,
      }),
      PARTIAL_INFO,
      [
        { episode_index: 0, length: 3, tasks: [] },
        { episode_index: 1, length: 3, tasks: [] },
      ],
    );
    expect(presence.present).toEqual([]);
    expect(clampV2EpisodesToExisting(presence)).toHaveLength(2);
  });

  it('initializes a partial v2 dataset instead of rejecting it', async () => {
    const loader = new LeRobotDataLoader(memorySource(partialFiles()));
    try {
      await expect(loader.initialize()).resolves.toMatchObject({ codebase_version: 'v2.1' });
      expect(loader.getEpisodes().map((episode) => episode.episode_index)).toEqual([0]);
      expect(loader.getValidationReport()?.hasError).toBe(true);
    } finally {
      await loader.dispose();
    }
  });
});
