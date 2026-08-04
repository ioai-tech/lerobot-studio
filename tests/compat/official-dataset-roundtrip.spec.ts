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

vi.mock('../../src/platform/workers/workerManager.ts', async () => {
  const { readParquetToIPC, readNumericColumns, readFeatureData } =
    await import('../helpers/parquet');
  return {
    createParquetWorker: () => ({
      readParquet: async (buffer: ArrayBuffer, columns?: string[]) =>
        readParquetToIPC(new Uint8Array(buffer), columns),
      readNumericColumns: async (
        buffer: ArrayBuffer,
        columns: string[],
        startRow: number,
        endRow: number,
      ) => readNumericColumns(new Uint8Array(buffer), columns, startRow, endRow),
      readFeatureData: async (
        buffer: ArrayBuffer,
        columns: string[],
        startRow: number,
        endRow: number,
      ) => readFeatureData(new Uint8Array(buffer), columns, startRow, endRow),
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import { ExportService, LeRobotDataLoader } from '@/platform';
import { LocalFsDataSource } from '../helpers/localFsDataSource';
import { DirectoryExportAdapter } from '../helpers/directoryExportAdapter';

const execFileAsync = promisify(execFile);
const python = process.env.LEROBOT_PYTHON;
const fixturesRoot = path.resolve(import.meta.dirname, '../fixtures/datasets/lerobotv2');
const tempDirs: string[] = [];
const OFFICIAL_READER_TIMEOUT_MS = 30_000;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(!python)('official LeRobot dataset compatibility', () => {
  it(
    'loads a Studio v2-to-v3 numeric export with LeRobotDataset',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'lerobot-studio-dataset-'));
      tempDirs.push(root);
      const loader = new LeRobotDataLoader(new LocalFsDataSource(fixturesRoot));
      const sourceInfo = await loader.initialize();
      const info = {
        ...sourceInfo,
        total_videos: 0,
        chunks_size: 1,
        data_files_size_in_mb: 0.000001,
        features: Object.fromEntries(
          Object.entries(sourceInfo.features).filter(([, feature]) => feature.dtype !== 'video'),
        ),
      };
      const adapter = new DirectoryExportAdapter(root);

      try {
        await new ExportService(loader, adapter).exportWithData(
          info,
          loader.getEpisodes(),
          loader.getTasks(),
          {
            format: 'directory',
            targetVersion: 'v3.0',
            includeData: true,
            includeVideos: false,
            onProgress: () => undefined,
          },
        );
      } finally {
        await loader.dispose();
      }

      const script = [
        'import json, sys',
        'from pathlib import Path',
        'import pyarrow as pa',
        'import pyarrow.parquet as pq',
        'from lerobot.datasets.lerobot_dataset import LeRobotDataset',
        'dataset = LeRobotDataset("local/roundtrip", root=sys.argv[1], download_videos=False)',
        'stats = json.load(open(sys.argv[1] + "/meta/stats.json"))',
        'files = sorted(Path(sys.argv[1]).glob("data/chunk-*/file-*.parquet"))',
        'table = pa.concat_tables([pq.read_table(file) for file in files])',
        'columns = {}',
        'for key in ("index", "episode_index", "task_index"):',
        '    values = [float(v) for v in table[key].to_pylist()]',
        '    columns[key] = {"min": min(values), "max": max(values), "mean": sum(values) / len(values), "count": len(values)}',
        'refs = [(int(ep["data/chunk_index"]), int(ep["data/file_index"])) for ep in dataset.meta.episodes]',
        'print(json.dumps({"frames": len(dataset), "episodes": dataset.meta.total_episodes, "files": len(files), "refs": refs, "stats": {key: {name: stats[key][name] for name in ("min", "max", "mean", "count")} for key in columns}, "columns": columns}))',
      ].join('\n');
      const { stdout } = await execFileAsync(python!, ['-c', script, root], {
        env: { ...process.env, HF_HUB_OFFLINE: '1' },
      });
      const parsed = JSON.parse(stdout.trim()) as {
        frames: number;
        episodes: number;
        files: number;
        refs: number[][];
        stats: Record<string, Record<string, number[]>>;
        columns: Record<string, Record<string, number>>;
      };
      expect(parsed).toMatchObject({
        frames: 6,
        episodes: 2,
        files: 2,
        refs: [
          [0, 0],
          [1, 0],
        ],
      });
      for (const key of ['index', 'episode_index', 'task_index']) {
        expect(parsed.stats[key].min[0]).toBe(parsed.columns[key].min);
        expect(parsed.stats[key].max[0]).toBe(parsed.columns[key].max);
        expect(parsed.stats[key].mean[0]).toBeCloseTo(parsed.columns[key].mean, 10);
        expect(parsed.stats[key].count[0]).toBe(parsed.columns[key].count);
      }
    },
    OFFICIAL_READER_TIMEOUT_MS,
  );

  it(
    'loads a Studio v2-to-v3 MP4 export and resolves the official video paths',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'lerobot-studio-video-'));
      tempDirs.push(root);
      const loader = new LeRobotDataLoader(new LocalFsDataSource(fixturesRoot));
      const info = await loader.initialize();
      const adapter = new DirectoryExportAdapter(root);

      try {
        await new ExportService(loader, adapter).exportWithData(
          info,
          loader.getEpisodes(),
          loader.getTasks(),
          {
            format: 'directory',
            targetVersion: 'v3.0',
            includeData: true,
            includeVideos: true,
            onProgress: () => undefined,
          },
        );
      } finally {
        await loader.dispose();
      }

      const script = [
        'import json, sys',
        'from lerobot.datasets.lerobot_dataset import LeRobotDataset',
        'dataset = LeRobotDataset("local/roundtrip", root=sys.argv[1], download_videos=False)',
        'path = dataset.meta.get_video_file_path(0, "observation.images.cam")',
        'print(json.dumps({"frames": len(dataset), "video_exists": (dataset.root / path).is_file()}))',
      ].join('; ');
      const { stdout } = await execFileAsync(python!, ['-c', script, root], {
        env: { ...process.env, HF_HUB_OFFLINE: '1' },
      });
      expect(JSON.parse(stdout.trim())).toEqual({ frames: 6, video_exists: true });
    },
    OFFICIAL_READER_TIMEOUT_MS,
  );

  it(
    'keeps frame tasks aligned when one of two same-task episodes is edited',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'lerobot-studio-task-edit-'));
      tempDirs.push(root);
      const loader = new LeRobotDataLoader(new LocalFsDataSource(fixturesRoot));
      const sourceInfo = await loader.initialize();
      const info = {
        ...sourceInfo,
        total_videos: 0,
        features: Object.fromEntries(
          Object.entries(sourceInfo.features).filter(([, feature]) => feature.dtype !== 'video'),
        ),
      };
      const episodes = loader
        .getEpisodes()
        .map((episode, index) =>
          index === 1
            ? { ...episode, tasks: ['place'], task_index: undefined }
            : { ...episode, task_index: 0 },
        );
      const adapter = new DirectoryExportAdapter(root);

      try {
        await new ExportService(loader, adapter).exportWithData(info, episodes, loader.getTasks(), {
          format: 'directory',
          targetVersion: 'v3.0',
          includeData: true,
          includeVideos: false,
          onProgress: () => undefined,
        });
      } finally {
        await loader.dispose();
      }

      const script = [
        'import json, sys',
        'from lerobot.datasets.lerobot_dataset import LeRobotDataset',
        'dataset = LeRobotDataset("local/roundtrip", root=sys.argv[1], download_videos=False)',
        'rows = [dataset[i] for i in range(len(dataset))]',
        'tasks = [str(row["task"]) for row in rows]',
        'indices = [int(row["task_index"].item() if hasattr(row["task_index"], "item") else row["task_index"]) for row in rows]',
        'print(json.dumps({"tasks": tasks, "indices": indices}))',
      ].join('; ');
      const { stdout } = await execFileAsync(python!, ['-c', script, root], {
        env: { ...process.env, HF_HUB_OFFLINE: '1' },
      });
      expect(JSON.parse(stdout.trim())).toEqual({
        tasks: ['pick cube', 'pick cube', 'pick cube', 'place', 'place', 'place'],
        indices: [0, 0, 0, 1, 1, 1],
      });
    },
    OFFICIAL_READER_TIMEOUT_MS,
  );
});
