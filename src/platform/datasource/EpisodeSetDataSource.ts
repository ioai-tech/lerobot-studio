import type { DataSource, ProgressHandler } from '../../core/datasource/types';
import { formatLeRobotPath } from '../../core/versioning/pathTemplate';
import type { DataSourceSafetyLimits } from './inputSafety';
import { RemoteManifestDataSource, type RemoteFileEntry } from './RemoteManifestDataSource';

/** One recording whose files an episode set plays from: a single-episode LeRobot v3 tree. */
export interface EpisodeSetRecording {
  /** Host identifier of the recording (or its processed result). */
  id: string;
  /** Host-signed files of the recording, at their paths inside its own tree. */
  files: RemoteFileEntry[];
  /** `info.video_path`-style template of the recording's preview copy, when it has one. */
  previewVideoPath?: string | null;
}

/** One episode: a row range of one recording. */
export interface EpisodeSetEpisode {
  recordingId: string;
  task: string;
  /** First row of the episode in the recording's data file (inclusive). */
  fromRow: number;
  /** End row (exclusive). */
  toRow: number;
  /** Start time of the episode in the recording's videos, seconds. */
  fromS: number;
  /** End time, seconds. */
  toS: number;
}

/** A dataset assembled from episodes of several recordings, without copying any file. */
export interface EpisodeSetManifest {
  fps: number;
  /** `info.json` features shared by every recording (LeRobot feature specs). */
  features: Record<string, unknown>;
  recordings: EpisodeSetRecording[];
  episodes: EpisodeSetEpisode[];
  robotType?: string | null;
}

/** Options for an episode set whose presigned URLs expire. */
export interface EpisodeSetOptions {
  /** Re-signs the recordings' files (same paths, new URLs); see `RemoteManifestOptions.refresh`. */
  refresh?: () => Promise<EpisodeSetRecording[]>;
}

/**
 * Where the episode set exposes the recordings' preview copies; pass it as the viewer's
 * `previewVideoPath`. Recordings without a preview fall back to their original videos.
 */
export const EPISODE_SET_PREVIEW_VIDEO_PATH =
  'meta/embodiflow/preview/videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';

const CHUNK_SIZE = 1000;
const DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const VIDEO_PATH = 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';
const DATA_FILE = /^data\/chunk-\d+\/file-\d+\.parquet$/;
const VIDEO_FILE = /^videos\/(.+)\/chunk-\d+\/file-\d+\.mp4$/;

function videoKeys(features: Record<string, unknown>): string[] {
  return Object.entries(features)
    .filter(([, spec]) => (spec as { dtype?: string } | null)?.dtype === 'video')
    .map(([key]) => key);
}

/**
 * Maps every recording to its own virtual `chunk/file` slot: recording `k` plays as
 * `data/chunk-{k/1000}/file-{k%1000}.parquet` and the matching videos, so the standard v3 adapter,
 * Range reads and native playback work unchanged. Each recording must hold exactly one data file
 * and one video per camera (the single-episode tree); anything else is refused, never guessed.
 */
function virtualEntries(
  recordings: EpisodeSetRecording[],
  keys: string[],
): { entries: RemoteFileEntry[]; slots: Map<string, { chunk: number; file: number }> } {
  const entries: RemoteFileEntry[] = [];
  const slots = new Map<string, { chunk: number; file: number }>();
  recordings.forEach((recording, k) => {
    if (slots.has(recording.id)) {
      throw new Error(`Episode set lists recording ${recording.id} twice`);
    }
    const slot = { chunk: Math.floor(k / CHUNK_SIZE), file: k % CHUNK_SIZE };
    slots.set(recording.id, slot);
    const data = recording.files.filter((file) => DATA_FILE.test(file.logicalPath));
    if (data.length !== 1) {
      throw new Error(
        `Recording ${recording.id} has ${data.length} data files; an episode set needs exactly one`,
      );
    }
    entries.push({ ...data[0], logicalPath: formatLeRobotPath(DATA_PATH, slotValues(slot)) });
    const preview = recording.previewVideoPath?.trim() || null;
    for (const key of keys) {
      const original = recording.files.find(
        (file) => VIDEO_FILE.exec(file.logicalPath)?.[1] === key,
      );
      if (original) {
        entries.push({
          ...original,
          logicalPath: formatLeRobotPath(VIDEO_PATH, { ...slotValues(slot), video_key: key }),
        });
      }
      if (!preview) continue;
      const previewPath = formatLeRobotPath(preview, {
        video_key: key,
        chunk_index: 0,
        file_index: 0,
      });
      const previewFile = recording.files.find((file) => file.logicalPath === previewPath);
      if (previewFile) {
        entries.push({
          ...previewFile,
          logicalPath: formatLeRobotPath(EPISODE_SET_PREVIEW_VIDEO_PATH, {
            ...slotValues(slot),
            video_key: key,
          }),
        });
      }
    }
  });
  return { entries, slots };
}

function slotValues(slot: { chunk: number; file: number }) {
  return { chunk_index: slot.chunk, file_index: slot.file };
}

/**
 * A `DataSource` that plays a set of episodes from several recordings (a curated dataset version)
 * as one LeRobot v3 dataset: `info.json` and the episode rows are built in memory, every data and
 * video file is the recording's own presigned file. Nothing is copied or re-encoded.
 */
export class EpisodeSetDataSource implements DataSource {
  private readonly files: RemoteManifestDataSource;
  private readonly infoText: string;
  private readonly rows: Array<Record<string, unknown>>;

  constructor(
    manifest: EpisodeSetManifest,
    options: EpisodeSetOptions = {},
    limits?: Partial<DataSourceSafetyLimits>,
  ) {
    const keys = videoKeys(manifest.features);
    const { entries, slots } = virtualEntries(manifest.recordings, keys);
    const refresh = options.refresh;
    this.files = new RemoteManifestDataSource(entries, limits, {
      refresh: refresh ? async () => virtualEntries(await refresh(), keys).entries : undefined,
    });

    this.rows = manifest.episodes.map((episode, index) => {
      const slot = slots.get(episode.recordingId);
      if (!slot) throw new Error(`Episode ${index} names unknown recording ${episode.recordingId}`);
      if (!(episode.toRow > episode.fromRow) || episode.fromRow < 0) {
        throw new Error(`Episode ${index} has an empty or negative row range`);
      }
      const row: Record<string, unknown> = {
        episode_index: index,
        tasks: [episode.task],
        length: episode.toRow - episode.fromRow,
        dataset_from_index: episode.fromRow,
        dataset_to_index: episode.toRow,
        'data/chunk_index': slot.chunk,
        'data/file_index': slot.file,
        'meta/episodes/chunk_index': 0,
        'meta/episodes/file_index': 0,
      };
      for (const key of keys) {
        row[`videos/${key}/chunk_index`] = slot.chunk;
        row[`videos/${key}/file_index`] = slot.file;
        row[`videos/${key}/from_timestamp`] = episode.fromS;
        row[`videos/${key}/to_timestamp`] = episode.toS;
      }
      return row;
    });

    const totalFrames = manifest.episodes.reduce((sum, e) => sum + (e.toRow - e.fromRow), 0);
    this.infoText = JSON.stringify({
      codebase_version: 'v3.0',
      robot_type: manifest.robotType ?? null,
      fps: manifest.fps,
      features: manifest.features,
      total_episodes: manifest.episodes.length,
      total_frames: totalFrames,
      total_tasks: new Set(manifest.episodes.map((e) => e.task)).size,
      total_videos: keys.length * manifest.recordings.length,
      chunks_size: CHUNK_SIZE,
      data_path: DATA_PATH,
      video_path: VIDEO_PATH,
    });
  }

  async readEpisodeRows(): Promise<Array<Record<string, unknown>>> {
    return this.rows;
  }

  async exists(path: string): Promise<boolean> {
    return isInfo(path) || this.files.exists(path);
  }

  async listPaths(): Promise<string[]> {
    return ['meta/info.json', ...(await this.files.listPaths())];
  }

  async readText(path: string, onProgress?: ProgressHandler): Promise<string> {
    if (isInfo(path)) return this.infoText;
    return new TextDecoder().decode(await this.readBytes(path, onProgress));
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    if (isInfo(path)) return new TextEncoder().encode(this.infoText);
    return this.files.readBytes(path, onProgress);
  }

  getObjectUrl(path: string): Promise<string> {
    return this.files.getObjectUrl(path);
  }

  getSize(path: string): Promise<number> {
    return this.files.getSize(path);
  }

  readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
    return this.files.readRange(path, offset, length);
  }

  invalidateObjectUrl(path: string): void {
    this.files.invalidateObjectUrl(path);
  }

  clear(): void {
    this.files.clear();
  }
}

function isInfo(path: string): boolean {
  return path.replace(/^\.?\/+/, '') === 'meta/info.json';
}
