import { tableFromIPC } from 'apache-arrow';
import type { EpisodeMetadataV3, LeRobotInfo, EpisodeMetadata } from '../types/lerobot';
import { isV3Metadata } from '../types/lerobot';
import type { DataSource } from '../datasource/types';
import type {
  EpisodeDataPathResult,
  EpisodeVideoPathResult,
  MetadataLoadingHelpers,
} from './types';
import { LeRobotVersionAdapter } from './LeRobotVersionAdapter';
import {
  convertArrowValue,
  normalizeTaskDisplay,
  TASK_DESCRIPTION_COLUMN_CANDIDATES,
} from './arrowUtils';
import { formatLeRobotPath } from './pathTemplate';

const TASKS_PARQUET_PATH = 'meta/tasks.parquet';
const DEFAULT_CHUNKS_SIZE = 1000;
const DEFAULT_DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const DEFAULT_VIDEO_PATH = 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';
const BASE_EPISODE_COLUMNS = [
  'episode_index',
  'length',
  'task_index',
  'dataset_from_index',
  'dataset_to_index',
  'chunk_index',
  'file_index',
  'data/chunk_index',
  'data/file_index',
] as const;

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

function episodeFilePath(chunkIdx: number, fileIdx: number): string {
  return `meta/episodes/chunk-${pad(chunkIdx)}/file-${pad(fileIdx)}.parquet`;
}

function compareEpisodeShardPaths(left: string, right: string): number {
  const indices = (path: string): [number, number] => {
    const match = /^meta\/episodes\/chunk-(\d+)\/file-(\d+)\.parquet$/.exec(path);
    if (!match) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    return [Number(match[1]), Number(match[2])];
  };
  const [leftChunk, leftFile] = indices(left);
  const [rightChunk, rightFile] = indices(right);
  return leftChunk - rightChunk || leftFile - rightFile;
}

function buildDataFilePath(info: LeRobotInfo, chunkValue: unknown, fileValue: unknown): string {
  const chunkIdx = chunkValue !== undefined && chunkValue !== null ? Number(chunkValue) : 0;
  const fileIdx = fileValue !== undefined && fileValue !== null ? Number(fileValue) : 0;
  return formatLeRobotPath(info.data_path || DEFAULT_DATA_PATH, {
    chunk_index: chunkIdx,
    file_index: fileIdx,
  });
}

function getDataChunkValue(episode: EpisodeMetadata): unknown {
  const record = episode as Record<string, unknown>;
  return record['data/chunk_index'] ?? record.chunk_index;
}

function getDataFileValue(episode: EpisodeMetadata): unknown {
  const record = episode as Record<string, unknown>;
  return record['data/file_index'] ?? record.file_index;
}

function getEpisodeColumnsToLoad(info?: LeRobotInfo): string[] {
  const columns = new Set<string>(BASE_EPISODE_COLUMNS);

  Object.entries(info?.features ?? {}).forEach(([featureKey, feature]) => {
    if (feature?.dtype !== 'video') return;
    columns.add(`videos/${featureKey}/chunk_index`);
    columns.add(`videos/${featureKey}/file_index`);
    columns.add(`videos/${featureKey}/from_timestamp`);
    columns.add(`videos/${featureKey}/to_timestamp`);
  });

  return Array.from(columns);
}

/**
 * Adapter for LeRobot codebase v3.0.
 * - Episodes: meta/episodes/ directory (one or more parquet files, all loaded)
 * - Tasks: meta/tasks.jsonl or meta/tasks.parquet
 * - Data: per-episode Parquet files, row range given by dataset_from_index / dataset_to_index
 * - Video: per-episode mp4 files, time range given by from_timestamp / to_timestamp in episode meta
 */
export class V3Adapter extends LeRobotVersionAdapter {
  private episodesByIndex = new Map<number, EpisodeMetadataV3>();
  private dataFileStartByPath = new Map<string, number>();

  get version(): string {
    return 'v3.0';
  }

  getEpisodeDataPath(
    _info: LeRobotInfo,
    episodes: EpisodeMetadata[],
    episodeIndex: number,
  ): EpisodeDataPathResult | null {
    const ep =
      this.episodesByIndex.get(episodeIndex) ??
      episodes.find((e) => e.episode_index === episodeIndex);
    if (!ep || !isV3Metadata(ep)) return null;
    const path = buildDataFilePath(_info, getDataChunkValue(ep), getDataFileValue(ep));

    // dataset_from_index / dataset_to_index are GLOBAL row indices across the concatenated
    // dataset (official LeRobot v3 format). We need LOCAL row indices within this file.
    const fallbackFileStart = episodes
      .filter(
        (episode) =>
          buildDataFilePath(_info, getDataChunkValue(episode), getDataFileValue(episode)) === path,
      )
      .reduce((min, episode) => {
        const candidate = Number((episode as Record<string, unknown>).dataset_from_index ?? 0);
        return Math.min(min, candidate);
      }, Infinity);
    const fileStart =
      this.dataFileStartByPath.get(path) ?? (isFinite(fallbackFileStart) ? fallbackFileStart : 0);

    return {
      path,
      startRow: Number(ep.dataset_from_index) - fileStart,
      endRow: Number(ep.dataset_to_index) - fileStart,
    };
  }

  getEpisodeVideoPath(
    _info: LeRobotInfo,
    episodes: EpisodeMetadata[],
    episodeIndex: number,
    featureKey: string,
  ): EpisodeVideoPathResult | null {
    const ep =
      this.episodesByIndex.get(episodeIndex) ??
      episodes.find((e) => e.episode_index === episodeIndex);
    if (!ep || !isV3Metadata(ep)) return null;
    const chunk = (ep as Record<string, unknown>)[`videos/${featureKey}/chunk_index`] ?? 0;
    const file = (ep as Record<string, unknown>)[`videos/${featureKey}/file_index`] ?? 0;
    const from = (ep as Record<string, unknown>)[`videos/${featureKey}/from_timestamp`] as
      number | undefined;
    const to = (ep as Record<string, unknown>)[`videos/${featureKey}/to_timestamp`] as
      number | undefined;
    const path = formatLeRobotPath(_info.video_path || DEFAULT_VIDEO_PATH, {
      video_key: featureKey,
      chunk_index: Number(chunk),
      file_index: Number(file),
    });
    return {
      path,
      fromSec: from != null ? from : undefined,
      toSec: to != null ? to : undefined,
    };
  }

  async loadEpisodes(
    dataSource: DataSource,
    helpers: MetadataLoadingHelpers,
    info?: LeRobotInfo,
  ): Promise<EpisodeMetadata[]> {
    const chunksSize =
      ((info as Record<string, unknown> | undefined)?.chunks_size as number | undefined) ??
      DEFAULT_CHUNKS_SIZE;
    const requestedColumns = getEpisodeColumnsToLoad(info);
    const allEpisodes: EpisodeMetadataV3[] = [];
    let chunkIdx = 0;
    let fileIdx = 0;
    this.episodesByIndex.clear();
    this.dataFileStartByPath.clear();

    // The official loader recursively reads every parquet under meta/episodes.
    // Indexed sources can enumerate exact paths; legacy sources retain the
    // conservative sequential fallback for backwards compatibility.
    const discoveredPaths = dataSource.listPaths
      ? (await dataSource.listPaths())
          .filter((path) => /^meta\/episodes\/chunk-\d+\/file-\d+\.parquet$/.test(path))
          .sort(compareEpisodeShardPaths)
      : [];
    const paths = discoveredPaths.length > 0 ? discoveredPaths : undefined;
    let pathIndex = 0;

    while (true) {
      const path = paths?.[pathIndex] ?? episodeFilePath(chunkIdx, fileIdx);
      let ipcBytes: Uint8Array;
      try {
        ipcBytes = await helpers.readParquetToIPC(path, requestedColumns);
      } catch {
        if (paths) {
          throw new Error(`Failed to read v3 episode metadata shard: ${path}`);
        }
        break;
      }

      const table = tableFromIPC(ipcBytes);
      const fields = table.schema.fields;
      for (let i = 0; i < table.numRows; i++) {
        const row: Record<string, unknown> = {};
        fields.forEach((field) => {
          const vector = table.getChild(field.name);
          if (vector) row[field.name] = convertArrowValue(vector.get(i));
        });
        allEpisodes.push(row as EpisodeMetadataV3);
      }

      if (paths) {
        pathIndex++;
        if (pathIndex >= paths.length) break;
      } else {
        fileIdx++;
        if (fileIdx >= chunksSize) {
          fileIdx = 0;
          chunkIdx++;
        }
      }
    }

    allEpisodes.forEach((episode) => {
      this.episodesByIndex.set(episode.episode_index, episode);
      const path = buildDataFilePath(
        info ??
          ({
            data_path: DEFAULT_DATA_PATH,
          } as LeRobotInfo),
        getDataChunkValue(episode),
        getDataFileValue(episode),
      );
      const datasetFromIndex = Number((episode as Record<string, unknown>).dataset_from_index ?? 0);
      const cachedStart = this.dataFileStartByPath.get(path);
      this.dataFileStartByPath.set(
        path,
        cachedStart === undefined ? datasetFromIndex : Math.min(cachedStart, datasetFromIndex),
      );
    });

    return allEpisodes;
  }

  async loadTasks(
    dataSource: DataSource,
    helpers: MetadataLoadingHelpers,
  ): Promise<Record<number, string>> {
    const tasks: Record<number, string> = {};
    try {
      const ipcBytes = await helpers.readParquetToIPC(TASKS_PARQUET_PATH);
      const table = tableFromIPC(ipcBytes);
      const schemaNames = new Set(table.schema.fields.map((f) => f.name));
      const taskColumnName = TASK_DESCRIPTION_COLUMN_CANDIDATES.find((name) =>
        schemaNames.has(name),
      );
      const taskVector = taskColumnName ? table.getChild(taskColumnName) : null;
      const indexVector = table.getChild('task_index');
      const numRows = table.numRows;
      for (let i = 0; i < numRows; i++) {
        const index =
          indexVector !== null && indexVector.get(i) !== undefined && indexVector.get(i) !== null
            ? Number(indexVector.get(i))
            : i;
        const rawTask = taskVector ? taskVector.get(i) : undefined;
        const converted = convertArrowValue(rawTask);
        const display = normalizeTaskDisplay(converted);
        tasks[index] = display !== '' ? display : 'Unknown Task';
      }
      return tasks;
    } catch {
      try {
        const text = await dataSource.readText('meta/tasks.jsonl');
        return LeRobotVersionAdapter.parseTasksFromJsonl(text);
      } catch (error) {
        console.warn('Failed to load tasks.parquet and legacy tasks.jsonl', error);
        return {};
      }
    }
  }
}

export const v3Adapter = new V3Adapter();
