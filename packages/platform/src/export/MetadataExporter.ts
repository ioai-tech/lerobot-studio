import * as arrow from 'apache-arrow';
import type { LeRobotInfo, EpisodeMetadata } from '@ioai/lerobot-studio-core';
import type { ExportAdapter } from '@ioai/lerobot-studio-core';
import type { ExportProgress, EpisodeVideoOffsets } from '@ioai/lerobot-studio-core';
import type { DatasetStats } from '@ioai/lerobot-studio-core';

const TEXT_ENCODER = new TextEncoder();
const V3_DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const V3_VIDEO_PATH = 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';

export async function writeMetadata(
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  tasks: Record<number, string>,
  targetVersion: 'v2.1' | 'v3.0' | undefined,
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  videoOffsetsByEpisode?: EpisodeVideoOffsets,
  signal?: AbortSignal,
  stats?: DatasetStats,
  splits?: Record<string, string>,
): Promise<void> {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const isTargetV3 = targetVersion?.startsWith('v3') ?? info.codebase_version.startsWith('v3');
  const { total_videos: legacyTotalVideos, ...officialInfo } = info;

  const infoToWrite = {
    ...officialInfo,
    ...(!isTargetV3 && legacyTotalVideos !== undefined ? { total_videos: legacyTotalVideos } : {}),
    codebase_version: (targetVersion ?? info.codebase_version) as LeRobotInfo['codebase_version'],
    ...(isTargetV3 ? { data_path: V3_DATA_PATH, video_path: V3_VIDEO_PATH } : {}),
    total_episodes: episodes.length,
    total_frames: episodes.reduce((total, episode) => total + episode.length, 0),
    total_tasks: new Set(
      episodes.flatMap((episode) =>
        (episode.tasks ?? []).length > 0
          ? (episode.tasks ?? [])
          : episode.task_index !== undefined
            ? [tasks[episode.task_index] ?? String(episode.task_index)]
            : [],
      ),
    ).size,
    ...(isTargetV3 && splits != null && Object.keys(splits).length > 0 ? { splits } : {}),
  } as LeRobotInfo;

  adapter.writeFile('meta/info.json', TEXT_ENCODER.encode(JSON.stringify(infoToWrite, null, 2)));

  if (!isTargetV3 && splits != null && Object.keys(splits).length > 0) {
    adapter.writeFile('meta/splits.json', TEXT_ENCODER.encode(JSON.stringify(splits, null, 2)));
  }

  if (isTargetV3) {
    await writeV3Episodes(episodes, adapter, onProgress, info, videoOffsetsByEpisode, signal);
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    await writeV3Tasks(tasks, adapter, onProgress, signal);
  } else {
    writeV2Episodes(episodes, adapter);
    writeV2Tasks(tasks, adapter);
  }

  if (stats != null && Object.keys(stats).length > 0) {
    adapter.writeFile('meta/stats.json', TEXT_ENCODER.encode(JSON.stringify(stats, null, 2)));
  }
}

function writeV2Episodes(episodes: EpisodeMetadata[], adapter: ExportAdapter): void {
  // Export uses 0-based contiguous episode_index so the exported dataset is self-contained.
  const lines = episodes.map((ep, i) => JSON.stringify({ ...ep, episode_index: i })).join('\n');
  adapter.writeFile('meta/episodes.jsonl', TEXT_ENCODER.encode(lines));
}

function writeV2Tasks(tasks: Record<number, string>, adapter: ExportAdapter): void {
  // LeRobot v2.1 standard: meta/tasks.jsonl, one line per task: {"task_index": N, "task": "description"}
  const lines = Object.entries(tasks)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([idx, task]) => JSON.stringify({ task_index: Number(idx), task: String(task ?? '') }))
    .join('\n');
  adapter.writeFile('meta/tasks.jsonl', TEXT_ENCODER.encode(lines));
}

async function writeV3Episodes(
  episodes: EpisodeMetadata[],
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  info?: LeRobotInfo,
  videoOffsetsByEpisode?: EpisodeVideoOffsets,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  onProgress?.({
    phase: 'metadata',
    current: 0,
    total: 1,
    message: 'Writing episodes (Parquet)...',
    cancelable: false,
  });

  // Export uses 0-based contiguous episode_index so the exported dataset is self-contained.
  const n = episodes.length;
  const episodeIndex = episodes.map((_, i) => i);
  const length = episodes.map((e) => e.length);
  const tasksArr = episodes.map((e) => e.tasks ?? []);
  const taskIndex = episodes.map((e) => e.task_index ?? 0);

  const tableData: Record<string, unknown[]> = {
    episode_index: episodeIndex,
    length,
    tasks: tasksArr,
    task_index: taskIndex,
  };

  const chunksSize = info?.chunks_size ?? 1000;
  // dataset_from_index / dataset_to_index must point into the *exported* data files (cumulative row offsets).
  let cum = 0;
  const datasetFromIndex = new Array<number>(n);
  const datasetToIndex = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    datasetFromIndex[i] = cum;
    cum += length[i];
    datasetToIndex[i] = cum;
  }
  tableData.dataset_from_index = datasetFromIndex;
  tableData.dataset_to_index = datasetToIndex;

  // Data path: one file per chunk (file-000.parquet). v3Adapter uses data/chunk_index, data/file_index when present.
  tableData['data/chunk_index'] = episodes.map((_, i) => Math.floor(i / chunksSize));
  tableData['data/file_index'] = episodes.map(() => 0);

  // Top-level chunk_index/file_index reflect the DATA layout, not video.
  // Previously this used the first video key, which was wrong for multi-camera
  // datasets where different cameras may live in different chunks.
  tableData.chunk_index = (tableData['data/chunk_index'] as number[]).slice();
  tableData.file_index = (tableData['data/file_index'] as number[]).slice();

  const videoKeys = info
    ? Object.entries(info.features)
        .filter(([, f]) => f?.dtype === 'video')
        .map(([k]) => k)
    : [];
  if (videoOffsetsByEpisode && videoKeys.length > 0) {
    for (const key of videoKeys) {
      tableData[`videos/${key}/chunk_index`] = episodes.map(
        (e) => videoOffsetsByEpisode.get(e.episode_index)?.[key]?.chunk_index ?? 0,
      );
      tableData[`videos/${key}/file_index`] = episodes.map(
        (e) => videoOffsetsByEpisode.get(e.episode_index)?.[key]?.file_index ?? 0,
      );
      tableData[`videos/${key}/from_timestamp`] = episodes.map(
        (e) => videoOffsetsByEpisode.get(e.episode_index)?.[key]?.from_timestamp ?? 0,
      );
      tableData[`videos/${key}/to_timestamp`] = episodes.map(
        (e) => videoOffsetsByEpisode.get(e.episode_index)?.[key]?.to_timestamp ?? 0,
      );
    }
  }

  const integerColumns = new Set([
    'episode_index',
    'length',
    'task_index',
    'dataset_from_index',
    'dataset_to_index',
    'chunk_index',
    'file_index',
    'data/chunk_index',
    'data/file_index',
  ]);
  const vectors = Object.fromEntries(
    Object.entries(tableData)
      .filter(([name]) => name !== 'tasks')
      .map(([name, values]) => {
        if (
          integerColumns.has(name) ||
          name.endsWith('/chunk_index') ||
          name.endsWith('/file_index')
        ) {
          return [
            name,
            arrow.vectorFromArray(
              values.map((value) => BigInt(Number(value))),
              new arrow.Int64(),
            ),
          ];
        }
        return [name, arrow.vectorFromArray(values)];
      }),
  );
  const table = new arrow.Table({
    ...vectors,
    tasks: arrow.vectorFromArray(
      tasksArr,
      new arrow.List(new arrow.Field('item', new arrow.Utf8(), true)),
    ),
  });
  const wasmModule = await import('./parquetWasmLoader').then((m) => m.getParquetWasm());
  const ipcBytes = arrow.tableToIPC(table, 'stream');
  const ipcCopy = new Uint8Array(ipcBytes.length);
  ipcCopy.set(ipcBytes);
  const wasmTable = wasmModule.Table.fromIPCStream(ipcCopy);
  const parquetBytes = wasmModule.writeParquet(wasmTable);

  await adapter.createDirectory('meta/episodes/chunk-000');
  adapter.writeFile('meta/episodes/chunk-000/file-000.parquet', parquetBytes);

  onProgress?.({
    phase: 'metadata',
    current: 1,
    total: 1,
    message: 'Episodes written.',
    cancelable: false,
  });
}

async function writeV3Tasks(
  tasks: Record<number, string>,
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  // LeRobot v2.1/v3.0 standard: meta/tasks.jsonl, one line per task: {"task_index": N, "task": "description"}
  const sorted = Object.entries(tasks).sort(([a], [b]) => Number(a) - Number(b));
  const lines = sorted
    .map(([idx, task]) => JSON.stringify({ task_index: Number(idx), task: String(task ?? '') }))
    .join('\n');
  adapter.writeFile('meta/tasks.jsonl', TEXT_ENCODER.encode(lines));

  // Official v3 also has meta/tasks.parquet (task_index + task columns for Python/pandas compatibility)
  if (sorted.length > 0) {
    const task_index = sorted.map(([idx]) => Number(idx));
    const task = sorted.map(([, desc]) => String(desc ?? ''));
    const tableData: Record<string, number[] | string[]> = { task_index, task };
    const table = arrow.tableFromArrays(tableData);
    const wasmModule = await import('./parquetWasmLoader').then((m) => m.getParquetWasm());
    const ipcBytes = arrow.tableToIPC(table, 'stream');
    const ipcCopy = new Uint8Array(ipcBytes.length);
    ipcCopy.set(ipcBytes);
    const wasmTable = wasmModule.Table.fromIPCStream(ipcCopy);
    const parquetBytes = wasmModule.writeParquet(wasmTable);
    adapter.writeFile('meta/tasks.parquet', parquetBytes);
  }

  onProgress?.({
    phase: 'metadata',
    current: 1,
    total: 1,
    message: 'Tasks written.',
    cancelable: false,
  });
}
