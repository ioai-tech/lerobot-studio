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
import { writeMetadata } from '../../src/platform/export/MetadataExporter';
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
          custom_label: 'alpha',
          custom_scores: [1, 2],
          'stats/action/mean': [0.25, 0.5],
        } as EpisodeMetadata,
        {
          episode_index: 8,
          length: 3,
          tasks: ['place'],
          task_index: 1,
          dataset_from_index: 102,
          dataset_to_index: 105,
          custom_label: 'beta',
          custom_scores: [3, 4],
          'stats/action/mean': [0.75, 1],
        } as EpisodeMetadata,
      ];

      await writeMetadata(info, episodes, { 0: 'pick', 1: 'place' }, 'v3.0', adapter);
      const script = [
        'import json, sys',
        'import pyarrow.parquet as pq',
        'from lerobot.datasets.dataset_metadata import LeRobotDatasetMetadata',
        'meta = LeRobotDatasetMetadata("local/roundtrip", root=sys.argv[1])',
        'table = pq.read_table(sys.argv[1] + "/meta/episodes/chunk-000/file-000.parquet")',
        'rows = table.to_pylist()',
        'print(json.dumps({"episodes": meta.total_episodes, "frames": meta.total_frames, "tasks": meta.total_tasks, "columns": table.column_names, "labels": [row["custom_label"] for row in rows], "scores": [row["custom_scores"] for row in rows], "means": [row["stats/action/mean"] for row in rows]}))',
      ].join('; ');
      const { stdout } = await execFileAsync(python!, ['-c', script, root], {
        env: { ...process.env, HF_HUB_OFFLINE: '1' },
      });

      const parsed = JSON.parse(stdout.trim()) as {
        episodes: number;
        frames: number;
        tasks: number;
        columns: string[];
        labels: string[];
        scores: number[][];
        means: number[][];
      };
      expect(parsed).toMatchObject({
        episodes: 2,
        frames: 5,
        tasks: 2,
        labels: ['alpha', 'beta'],
        scores: [
          [1, 2],
          [3, 4],
        ],
        means: [
          [0.25, 0.5],
          [0.75, 1],
        ],
      });
      expect(parsed.columns).toEqual(
        expect.arrayContaining([
          'meta/episodes/chunk_index',
          'meta/episodes/file_index',
          'custom_label',
          'custom_scores',
          'stats/action/mean',
        ]),
      );
    },
    OFFICIAL_READER_TIMEOUT_MS,
  );
});
