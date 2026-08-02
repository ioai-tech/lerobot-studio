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
        'from lerobot.datasets.lerobot_dataset import LeRobotDataset',
        'dataset = LeRobotDataset("local/roundtrip", root=sys.argv[1], download_videos=False)',
        'print(json.dumps({"frames": len(dataset), "episodes": dataset.meta.total_episodes}))',
      ].join('; ');
      const { stdout } = await execFileAsync(python!, ['-c', script, root]);
      expect(JSON.parse(stdout.trim())).toEqual({ frames: 6, episodes: 2 });
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
      const { stdout } = await execFileAsync(python!, ['-c', script, root]);
      expect(JSON.parse(stdout.trim())).toEqual({ frames: 6, video_exists: true });
    },
    OFFICIAL_READER_TIMEOUT_MS,
  );
});
