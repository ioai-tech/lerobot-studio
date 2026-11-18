import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/platform/export/parquetWasmLoader.ts', async () => {
  const { getParquetWasmNode } = await import('./helpers/parquetWasmNode');
  return { getParquetWasm: () => getParquetWasmNode() };
});

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const { readParquetToIPC, readNumericColumns, readFeatureData } =
    await import('./helpers/parquet');
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
import {
  annotationToExportSegments,
  type AnnotationDocument,
  type AnnotationField,
  type LeRobotInfo,
  type Segment,
} from '@/core';
import { DirectoryExportAdapter } from './helpers/directoryExportAdapter';
import { LocalFsDataSource } from './helpers/localFsDataSource';

const fixture = path.resolve(import.meta.dirname, 'fixtures/datasets/lerobotv2');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const fields: AnnotationField[] = [
  {
    id: 'outcome',
    label: 'Outcome',
    kind: 'select',
    options: [{ value: 'success', label: 'Success' }],
  },
];

function seg(
  id: string,
  startFrame: number,
  endFrame: number,
  extra: Partial<Segment> = {},
): Segment {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'confirmed',
    origin: { kind: 'manual' },
    ...extra,
  };
}

function withoutVideo(info: LeRobotInfo): LeRobotInfo {
  return {
    ...info,
    total_videos: 0,
    features: Object.fromEntries(
      Object.entries(info.features).filter(([, feature]) => feature.dtype !== 'video'),
    ),
  };
}

async function exportAndReopen(
  doc: AnnotationDocument,
  options: { fillSubtaskGaps?: boolean; includeSubtasks?: boolean } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lerobot-studio-segments-'));
  tempDirs.push(root);
  const source = new LeRobotDataLoader(new LocalFsDataSource(fixture));
  const sourceInfo = await source.initialize();
  const sourceFrames = new Map<number, Array<Record<string, unknown>>>();
  for (const episode of source.getEpisodes()) {
    sourceFrames.set(
      episode.episode_index,
      (await source.loadEpisodeData(episode.episode_index)) as unknown as Array<
        Record<string, unknown>
      >,
    );
  }
  try {
    await new ExportService(source, new DirectoryExportAdapter(root)).exportWithData(
      withoutVideo(sourceInfo),
      source.getEpisodes(),
      source.getTasks(),
      {
        format: 'directory',
        targetVersion: 'v3.0',
        includeData: true,
        includeVideos: false,
        includeSubtasks: options.includeSubtasks ?? false,
        fillSubtaskGaps: options.fillSubtaskGaps,
        segments: annotationToExportSegments(doc, fields),
      },
    );
  } finally {
    await source.dispose();
  }
  const output = new LeRobotDataLoader(new LocalFsDataSource(root));
  const info = await output.initialize();
  return { output, info, sourceFrames };
}

const numeric = (frames: Array<Record<string, unknown>>, key: string) =>
  frames.map((frame) => JSON.stringify(frame[key]));

describe('segment export round trip (v2.1 fixture → v3.0, reopened with the dataset loader)', () => {
  it('writes each segment as its own frame-exact episode; an episode without segments stays whole', async () => {
    const { output, info, sourceFrames } = await exportAndReopen(
      {
        episodes: {
          0: {
            segments: [
              seg('first', 0, 0, {
                task: 'reach',
                values: { outcome: 'success' },
                subtasks: [{ startFrame: 0, endFrame: 0, label: 'approach' }],
              }),
              seg('second', 1, 2, { subtasks: [{ startFrame: 1, endFrame: 1, label: 'grasp' }] }),
            ],
          },
        },
      },
      { includeSubtasks: true, fillSubtaskGaps: true },
    );
    try {
      expect(output.getValidationReport()?.errors ?? []).toEqual([]);
      expect(output.getVersionCapability().status).toBe('supported');
      const episodes = output.getEpisodes();
      expect(info.total_episodes).toBe(3);
      expect(info.total_frames).toBe(6);
      expect(episodes.map((episode) => [episode.episode_index, episode.length])).toEqual([
        [0, 1],
        [1, 2],
        [2, 3],
      ]);
      expect(episodes.map((episode) => episode.tasks)).toEqual([
        ['reach'],
        ['pick cube'],
        ['pick cube'],
      ]);

      const [source0, source1] = [sourceFrames.get(0)!, sourceFrames.get(1)!];
      const frames = await Promise.all([0, 1, 2].map((index) => output.loadEpisodeData(index)));
      const rows = frames as unknown as Array<Array<Record<string, unknown>>>;
      // Frame-exact: each exported row is the source row at the segment's frame.
      expect(numeric(rows[0], 'action')).toEqual(numeric(source0.slice(0, 1), 'action'));
      expect(numeric(rows[1], 'action')).toEqual(numeric(source0.slice(1, 3), 'action'));
      expect(numeric(rows[2], 'action')).toEqual(numeric(source1, 'action'));
      expect(numeric(rows[1], 'observation.state')).toEqual(
        numeric(source0.slice(1, 3), 'observation.state'),
      );
      // Frame indices and timestamps restart at zero per exported episode.
      expect(rows[1].map((frame) => Number(frame.frame_index))).toEqual([0, 1]);
      expect(rows[1].map((frame) => Number(frame.timestamp))).toEqual([0, expect.closeTo(0.1, 5)]);

      // Subtasks are clipped to each segment; uncovered frames are labelled "unlabeled".
      const labels = output.getSubtasks();
      const subtaskNames = async (index: number) =>
        (await output.loadEpisodeSubtaskIndices(index)).map((value) =>
          value == null ? null : labels[value],
        );
      expect(await subtaskNames(0)).toEqual(['approach']);
      expect(await subtaskNames(1)).toEqual(['grasp', 'unlabeled']);
      expect(await subtaskNames(2)).toEqual(['unlabeled', 'unlabeled', 'unlabeled']);
    } finally {
      await output.dispose();
    }
  });

  it('an empty document exports the dataset unchanged', async () => {
    const { output, sourceFrames } = await exportAndReopen({ episodes: {} });
    try {
      const episodes = output.getEpisodes();
      expect(episodes.map((episode) => episode.length)).toEqual([3, 3]);
      const rows = (await output.loadEpisodeData(1)) as unknown as Array<Record<string, unknown>>;
      expect(numeric(rows, 'action')).toEqual(numeric(sourceFrames.get(1)!, 'action'));
    } finally {
      await output.dispose();
    }
  });
});
