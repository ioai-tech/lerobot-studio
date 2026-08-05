import * as arrow from 'apache-arrow';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import type { ExportAdapter } from '@/core';
import type { ExportProgress, EpisodeVideoOffsets, V3DataLayout } from '@/core';
import type { DatasetStats } from '@/core';
import { isV3Info } from '../../core/types/lerobot';
import { buildExportTaskPlan, type ExportTaskPlan } from './TaskPlan';

const TEXT_ENCODER = new TextEncoder();
const V3_DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const V3_VIDEO_PATH = 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';
const V3_CHUNKS_SIZE_DEFAULT = 1000;
const V3_DATA_FILE_SIZE_MB_DEFAULT = 100;
const V3_VIDEO_FILE_SIZE_MB_DEFAULT = 200;

type SupportedEpisodeScalar = string | number | boolean;

function getV3RewrittenColumns(info?: LeRobotInfo): Set<string> {
  const columns = new Set([
    'episode_index',
    'length',
    'tasks',
    'task_index',
    'dataset_from_index',
    'dataset_to_index',
    'chunk_index',
    'file_index',
    'meta/episodes/chunk_index',
    'meta/episodes/file_index',
    'data/chunk_index',
    'data/file_index',
  ]);
  for (const [key, feature] of Object.entries(info?.features ?? {})) {
    if (feature?.dtype !== 'video') continue;
    columns.add(`videos/${key}/chunk_index`);
    columns.add(`videos/${key}/file_index`);
    columns.add(`videos/${key}/from_timestamp`);
    columns.add(`videos/${key}/to_timestamp`);
  }
  return columns;
}

function validateEpisodeScalar(column: string, value: unknown): SupportedEpisodeScalar {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error(
        `Cannot export v3 episode metadata column "${column}": number ${String(value)} is not safely serializable.`,
      );
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  throw new Error(
    `Cannot export v3 episode metadata column "${column}": unsupported value type ${Object.prototype.toString.call(value)}.`,
  );
}

function validatePreservedEpisodeColumn(column: string, values: unknown[]): void {
  let columnKind: 'scalar' | 'array' | undefined;
  let scalarKind: 'string' | 'number' | 'boolean' | undefined;
  let hasTypedValue = false;

  for (const value of values) {
    if (value == null) continue;
    const kind = Array.isArray(value) ? 'array' : 'scalar';
    if (columnKind !== undefined && kind !== columnKind) {
      throw new Error(
        `Cannot export v3 episode metadata column "${column}": scalar and array values cannot share one Parquet column.`,
      );
    }
    columnKind = kind;
    const items: unknown[] = [];
    const collectItems = (item: unknown): void => {
      if (Array.isArray(item)) item.forEach(collectItems);
      else items.push(item);
    };
    collectItems(value);
    for (const item of items) {
      if (item == null) continue;
      const scalar = validateEpisodeScalar(column, item);
      const itemKind: 'string' | 'number' | 'boolean' =
        typeof scalar === 'string' ? 'string' : typeof scalar === 'number' ? 'number' : 'boolean';
      if (scalarKind !== undefined && itemKind !== scalarKind) {
        throw new Error(
          `Cannot export v3 episode metadata column "${column}": mixed ${scalarKind} and ${itemKind} values are not supported.`,
        );
      }
      scalarKind = itemKind;
      hasTypedValue = true;
    }
  }

  if (!hasTypedValue) {
    throw new Error(
      `Cannot export v3 episode metadata column "${column}": its type cannot be inferred from only null or empty values.`,
    );
  }
}

function collectPreservedV3EpisodeColumns(
  episodes: EpisodeMetadata[],
  rewrittenColumns: Set<string>,
): Record<string, unknown[]> {
  const preserved: Record<string, unknown[]> = {};
  const extraKeys = new Set(episodes.flatMap((episode) => Object.keys(episode)));
  for (const key of extraKeys) {
    if (rewrittenColumns.has(key)) continue;
    const values = episodes.map((episode) => (episode as Record<string, unknown>)[key] ?? null);
    validatePreservedEpisodeColumn(key, values);
    preserved[key] = values;
  }
  return preserved;
}

function createPreservedEpisodeVector(values: unknown[]): arrow.Vector {
  const nonNullValue = values.find((value) => value != null);
  const isArray = Array.isArray(nonNullValue);
  const items: unknown[] = [];
  const collectItems = (value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) value.forEach(collectItems);
    else items.push(value);
  };
  values.forEach(collectItems);
  const sample = items[0] as SupportedEpisodeScalar;
  let itemType: arrow.DataType;
  let normalizedValues = values;

  if (typeof sample === 'string') {
    itemType = new arrow.Utf8();
  } else if (typeof sample === 'boolean') {
    itemType = new arrow.Bool();
  } else {
    const integerValues = items.every((item) => typeof item === 'number' && Number.isInteger(item));
    itemType = integerValues ? new arrow.Int64() : new arrow.Float64();
    if (integerValues) {
      const normalizeInteger = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(normalizeInteger)
          : value == null
            ? null
            : BigInt(value as number);
      normalizedValues = values.map(normalizeInteger);
    }
  }

  let type = itemType;
  if (isArray) {
    let current: unknown = nonNullValue;
    while (Array.isArray(current)) {
      type = new arrow.List(new arrow.Field('item', type, true));
      current = current[0];
    }
  }
  return arrow.vectorFromArray(normalizedValues, type);
}

function validateV3Splits(splits: Record<string, string> | undefined, episodeCount: number): void {
  for (const [name, range] of Object.entries(splits ?? {})) {
    const match = /^(\d+):(\d+)$/.exec(range);
    if (!match) {
      throw new Error(
        `Cannot export split "${name}": LeRobot v3 requires one continuous start:end range, got "${range}".`,
      );
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= end ||
      end > episodeCount
    ) {
      throw new Error(
        `Cannot export split "${name}": range "${range}" is outside the ${episodeCount} exported episodes.`,
      );
    }
  }
}

/** Validate all metadata that can fail before an export writes any files. */
export function validateMetadataForExport(
  info: LeRobotInfo,
  episodes: EpisodeMetadata[],
  targetVersion: 'v2.1' | 'v3.0' | undefined,
  splits?: Record<string, string>,
): void {
  const isTargetV3 = targetVersion !== undefined ? targetVersion === 'v3.0' : isV3Info(info);
  if (!isTargetV3) return;
  collectPreservedV3EpisodeColumns(episodes, getV3RewrittenColumns(info));
  validateV3Splits(splits, episodes.length);
}

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
  dataLayout?: V3DataLayout,
): Promise<void> {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const isTargetV3 = targetVersion !== undefined ? targetVersion === 'v3.0' : isV3Info(info);
  const taskPlan = buildExportTaskPlan(episodes, tasks);
  const { total_videos: legacyTotalVideos, ...officialInfo } = info;
  if (isTargetV3) {
    // Validate before writing info.json so unsupported extension metadata
    // cannot leave a deceptively successful partial export.
    validateMetadataForExport(info, episodes, targetVersion, splits);
  }

  const infoToWrite = {
    ...officialInfo,
    ...(!isTargetV3 && legacyTotalVideos !== undefined ? { total_videos: legacyTotalVideos } : {}),
    codebase_version: (targetVersion ?? info.codebase_version) as LeRobotInfo['codebase_version'],
    ...(isTargetV3
      ? {
          chunks_size: info.chunks_size ?? V3_CHUNKS_SIZE_DEFAULT,
          data_files_size_in_mb:
            (info as { data_files_size_in_mb?: number }).data_files_size_in_mb ??
            V3_DATA_FILE_SIZE_MB_DEFAULT,
          video_files_size_in_mb:
            (info as { video_files_size_in_mb?: number }).video_files_size_in_mb ??
            V3_VIDEO_FILE_SIZE_MB_DEFAULT,
          data_path: V3_DATA_PATH,
          video_path: V3_VIDEO_PATH,
        }
      : {}),
    total_episodes: episodes.length,
    total_frames: episodes.reduce((total, episode) => total + episode.length, 0),
    total_tasks: Object.keys(taskPlan.tasks).length,
    ...(isTargetV3 && splits != null && Object.keys(splits).length > 0 ? { splits } : {}),
  } as LeRobotInfo;

  adapter.writeFile('meta/info.json', TEXT_ENCODER.encode(JSON.stringify(infoToWrite, null, 2)));

  if (!isTargetV3 && splits != null && Object.keys(splits).length > 0) {
    adapter.writeFile('meta/splits.json', TEXT_ENCODER.encode(JSON.stringify(splits, null, 2)));
  }

  if (isTargetV3) {
    await writeV3Episodes(
      episodes,
      taskPlan,
      adapter,
      onProgress,
      info,
      videoOffsetsByEpisode,
      signal,
      dataLayout,
    );
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    await writeV3Tasks(taskPlan.tasks, adapter, onProgress, signal);
  } else {
    writeV2Episodes(episodes, taskPlan, adapter);
    writeV2Tasks(taskPlan.tasks, adapter);
  }

  if (stats != null && Object.keys(stats).length > 0) {
    adapter.writeFile('meta/stats.json', TEXT_ENCODER.encode(JSON.stringify(stats, null, 2)));
  }
}

function writeV2Episodes(
  episodes: EpisodeMetadata[],
  taskPlan: ExportTaskPlan,
  adapter: ExportAdapter,
): void {
  // Export uses 0-based contiguous episode_index so the exported dataset is self-contained.
  const lines = episodes
    .map((ep, i) => {
      const taskIndices = taskPlan.episodeTaskIndices[i];
      const { task_index: _sourceTaskIndex, ...preservedEpisode } = ep;
      void _sourceTaskIndex;
      return JSON.stringify({
        ...preservedEpisode,
        episode_index: i,
        tasks: taskIndices.map((index) => taskPlan.tasks[index]),
        ...(taskIndices.length === 1 ? { task_index: taskIndices[0] } : {}),
      });
    })
    .join('\n');
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
  taskPlan: ExportTaskPlan,
  adapter: ExportAdapter,
  onProgress?: (p: ExportProgress) => void,
  info?: LeRobotInfo,
  videoOffsetsByEpisode?: EpisodeVideoOffsets,
  signal?: AbortSignal,
  dataLayout?: V3DataLayout,
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
  const tasksArr = taskPlan.episodeTaskIndices.map((indices) =>
    indices.map((index) => taskPlan.tasks[index]),
  );

  const tableData: Record<string, unknown[]> = {
    episode_index: episodeIndex,
    length,
    tasks: tasksArr,
  };
  Object.assign(tableData, collectPreservedV3EpisodeColumns(episodes, getV3RewrittenColumns(info)));

  // dataset_from_index / dataset_to_index are global exported row offsets.
  let cum = 0;
  const datasetFromIndex = new Array<number>(n);
  const datasetToIndex = new Array<number>(n);
  const dataLocations = dataLayout
    ? episodes.map((episode) => {
        const location = dataLayout.episodes.get(episode.episode_index);
        if (!location) {
          throw new Error(`Missing exported data location for episode ${episode.episode_index}`);
        }
        return location;
      })
    : undefined;
  for (let i = 0; i < n; i++) {
    const location = dataLocations?.[i];
    if (
      location &&
      (location.dataset_from_index !== cum || location.dataset_to_index !== cum + length[i])
    ) {
      throw new Error(
        `Exported data row range for episode ${episodes[i].episode_index} does not match its length`,
      );
    }
    datasetFromIndex[i] = location?.dataset_from_index ?? cum;
    cum += length[i];
    datasetToIndex[i] = location?.dataset_to_index ?? cum;
  }
  tableData.dataset_from_index = datasetFromIndex;
  tableData.dataset_to_index = datasetToIndex;

  // References must match the actual size-rolled data shards. Metadata-only
  // exports have no produced layout and retain a single logical shard.
  tableData['data/chunk_index'] = episodes.map(
    (_, index) => dataLocations?.[index].chunk_index ?? 0,
  );
  tableData['data/file_index'] = episodes.map((_, index) => dataLocations?.[index].file_index ?? 0);

  // These columns locate each row's episode-metadata parquet shard. This
  // exporter currently emits one shard, so every row points to chunk/file 0.
  tableData['meta/episodes/chunk_index'] = episodes.map(() => 0);
  tableData['meta/episodes/file_index'] = episodes.map(() => 0);

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
    'dataset_from_index',
    'dataset_to_index',
    'meta/episodes/chunk_index',
    'meta/episodes/file_index',
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
        try {
          return [name, createPreservedEpisodeVector(values)];
        } catch (error) {
          throw new Error(
            `Cannot serialize v3 episode metadata column "${name}" to Arrow: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
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
    const task_index = arrow.vectorFromArray(
      sorted.map(([idx]) => BigInt(Number(idx))),
      new arrow.Int64(),
    );
    const task = sorted.map(([, desc]) => String(desc ?? ''));
    const baseTable = new arrow.Table({ task_index, task: arrow.vectorFromArray(task) });
    // Official LeRobot writes tasks from a pandas DataFrame whose string
    // `task` index maps each row to its numeric task_index. A plain Arrow
    // column is not enough: pandas otherwise restores a RangeIndex and the
    // official reader returns "0", "1", ... as task labels.
    const pandasMetadata = JSON.stringify({
      index_columns: ['task'],
      column_indexes: [
        {
          name: null,
          field_name: null,
          pandas_type: 'unicode',
          numpy_type: 'object',
          metadata: { encoding: 'UTF-8' },
        },
      ],
      columns: [
        {
          name: 'task_index',
          field_name: 'task_index',
          pandas_type: 'int64',
          numpy_type: 'int64',
          metadata: null,
        },
        {
          name: 'task',
          field_name: 'task',
          pandas_type: 'unicode',
          numpy_type: 'object',
          metadata: null,
        },
      ],
      attributes: {},
      creator: { library: 'lerobot-studio', version: '1.0.0' },
      pandas_version: '2.3.3',
    });
    const schema = new arrow.Schema(
      baseTable.schema.fields,
      new Map([...baseTable.schema.metadata, ['pandas', pandasMetadata]]),
    );
    const table = new arrow.Table(schema, baseTable.batches);
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
