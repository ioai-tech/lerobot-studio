import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

vi.mock('../../src/platform/export/parquetWasmLoader.ts', async () => {
  const { getParquetWasmNode } = await import('../helpers/parquetWasmNode');
  return { getParquetWasm: () => getParquetWasmNode() };
});

import type { EpisodeMetadata, LeRobotInfo } from '@/core';
import { writeMetadata } from '@/platform';
import { DirectoryExportAdapter } from '../helpers/directoryExportAdapter';

const execFileAsync = promisify(execFile);
const python = process.env.LEROBOT_PYTHON;
const tempDirs: string[] = [];
const OFFICIAL_READER_TIMEOUT_MS = 30_000;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(!python)('official LeRobot metadata compatibility', () => {
  it(
    'loads Studio v3 metadata through the official DatasetMetadata reader',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'lerobot-studio-'));
      tempDirs.push(root);
      const adapter = new DirectoryExportAdapter(root);
      const info: LeRobotInfo = {
        codebase_version: 'v3.0',
        robot_type: 'test',
        total_episodes: 99,
        total_frames: 999,
        total_tasks: 99,
        total_videos: 2,
        chunks_size: 1000,
        fps: 30,
        data_path: 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet',
        video_path: 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4',
        splits: { train: '0:2' },
        features: {
          'observation.state': { dtype: 'float32', shape: [1], names: null },
        },
      };
      const episodes: EpisodeMetadata[] = [
        {
          episode_index: 7,
          length: 2,
          tasks: ['pick', 'place'],
          task_index: 0,
          dataset_from_index: 100,
          dataset_to_index: 102,
        } as EpisodeMetadata,
        {
          episode_index: 8,
          length: 3,
          tasks: ['place'],
          task_index: 1,
          dataset_from_index: 102,
          dataset_to_index: 105,
        } as EpisodeMetadata,
      ];

      await writeMetadata(info, episodes, { 0: 'pick', 1: 'place' }, 'v3.0', adapter);
      const script = [
        'import json, sys',
        'from lerobot.datasets.dataset_metadata import LeRobotDatasetMetadata',
        'meta = LeRobotDatasetMetadata("local/roundtrip", root=sys.argv[1])',
        'print(json.dumps({"episodes": meta.total_episodes, "frames": meta.total_frames, "tasks": meta.total_tasks}))',
      ].join('; ');
      const { stdout } = await execFileAsync(python!, ['-c', script, root]);

      expect(JSON.parse(stdout.trim())).toEqual({ episodes: 2, frames: 5, tasks: 2 });
    },
    OFFICIAL_READER_TIMEOUT_MS,
  );
});
