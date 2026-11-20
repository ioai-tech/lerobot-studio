import { fileNotFoundError } from '../../core/datasource/readError';
import type { ByteRangeResult, DataSource, ProgressHandler } from '../../core/datasource/types';
import { formatLeRobotPath } from '../../core/versioning/pathTemplate';
import {
  DataSourceSafetyError,
  type DataSourceSafetyLimits,
  resolveSafetyLimits,
  validateUntrustedPath,
} from './inputSafety';
import { type RemoteFileEntry, validateManifestUrl } from './RemoteManifestDataSource';
import {
  Coalescer,
  fetchByteRange,
  fetchWithRefresh,
  normalizeLogicalPath,
  parseExpiresAt,
  ProactiveRefreshTimer,
  readResponseBytes,
  UrlChangeEmitter,
  type UrlRefresher,
} from './signedUrls';

/** One source recording of an episode set: a one-episode LeRobot v3 tree. */
export interface EpisodeSetRecording {
  /** Host identifier passed back to `resolve` / `refresh`. */
  id: string;
  /** Already-signed files of the recording's tree; omit to resolve lazily. */
  files?: RemoteFileEntry[];
  /**
   * Path template (with `{video_key}`) of a lighter copy of each camera inside
   * this recording's files. Overrides the option of the same name; `null`
   * disables it for this recording.
   */
  previewVideoPath?: string | null;
}

/** One episode of an episode set: a row range of one recording. */
export interface EpisodeSetEpisode {
  /** `EpisodeSetRecording.id` the rows belong to. */
  recordingId: string;
  /** Task text shown for the episode. */
  task: string;
  /** First row (inclusive) in the recording's data file. */
  fromRow: number;
  /** End row (exclusive) in the recording's data file. */
  toRow: number;
  /** Start of the episode in the recording's videos, in seconds. */
  fromS: number;
  /** End of the episode in the recording's videos, in seconds. */
  toS: number;
  /** Extra per-episode columns (for example a split name). */
  meta?: Record<string, string | number | null>;
}

/** A dataset view over episodes (row ranges) of several one-episode LeRobot v3 trees. */
export interface EpisodeSetManifest {
  /** Frames per second shared by every recording. */
  fps: number;
  /** `info.json` features shared by every recording. */
  features: Record<string, unknown>;
  /** Optional robot type for the synthesized `info.json`. */
  robotType?: string | null;
  recordings: EpisodeSetRecording[];
  episodes: EpisodeSetEpisode[];
}

/** Signed files of one recording, returned by `resolve` / `refresh`. */
export interface EpisodeSetResolvedRecording {
  id: string;
  files: RemoteFileEntry[];
}

/** Options for `createEpisodeSetDataSource`. */
export interface EpisodeSetOptions {
  /**
   * Sign the files of these recordings (at most 50 ids per call). Called
   * lazily: the first read of a recording resolves it together with the
   * recordings of the next two episodes.
   */
  resolve?: (ids: string[]) => Promise<EpisodeSetResolvedRecording[]>;
  /**
   * Re-sign already resolved recordings (401/403, or within 60 s of
   * `expiresAt`). Defaults to `resolve`. Only resolved ids are passed.
   */
  refresh?: (ids: string[]) => Promise<EpisodeSetResolvedRecording[]>;
  /** Default preview-copy path template with `{video_key}` (see `EpisodeSetRecording`). */
  previewVideoPath?: string;
}

/** Machine-readable episode-set failures. */
export type EpisodeSetErrorCode =
  'MANIFEST_INVALID' | 'RECORDING_LAYOUT_REFUSED' | 'RECORDING_RESOLVE_FAILED';

/** A typed episode-set failure; `recordingId` names the recording when there is one. */
export class EpisodeSetError extends Error {
  readonly name = 'EpisodeSetError';
  readonly code: EpisodeSetErrorCode;
  readonly recordingId?: string;

  constructor(
    code: EpisodeSetErrorCode,
    message: string,
    options: { recordingId?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.recordingId = options.recordingId;
  }
}

export const EPISODE_SET_RESOLVE_BATCH = 50;
const PREFETCH_RECORDINGS = 2;
const CHUNKS_SIZE = 1000;
const DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const VIDEO_PATH = 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';
const INFO_PATH = 'meta/info.json';
const TASKS_PATH = 'meta/tasks.jsonl';
const EPISODES_PATH = 'meta/episodes/chunk-000/file-000.parquet';
const RESERVED_COLUMNS = new Set([
  'episode_index',
  'tasks',
  'task_index',
  'length',
  'dataset_from_index',
  'dataset_to_index',
]);
const RESERVED_PREFIXES = ['data/', 'videos/', 'stats/', 'meta/'];

interface FileState {
  entry: RemoteFileEntry;
  expiresAtMs: number | null;
}

interface ResolvedFiles {
  data: FileState;
  videos: Map<string, FileState>;
}

type VirtualFile =
  | { kind: 'info' }
  | { kind: 'tasks' }
  | { kind: 'episodes' }
  | { kind: 'data'; recording: number }
  | { kind: 'video'; recording: number; videoKey: string };

function chunkOf(recording: number) {
  return { chunk_index: Math.floor(recording / CHUNKS_SIZE), file_index: recording % CHUNKS_SIZE };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A read-only LeRobot v3 dataset over episodes (row ranges) of several
 * one-episode v3 trees, with lazy, batched URL resolution.
 *
 * The virtual layout comes from the manifest alone, so opening the set signs
 * nothing: `meta/info.json`, `meta/tasks.jsonl` and the episode table are
 * synthesized, and recording `r` appears as data file and videos
 * `chunk-{r/1000}/file-{r%1000}`. The first read of a recording's file
 * resolves it (with the next two episodes' recordings, as prefetch).
 */
export class EpisodeSetDataSource implements DataSource {
  private readonly manifest: EpisodeSetManifest;
  private readonly options: EpisodeSetOptions;
  private readonly limits: Readonly<DataSourceSafetyLimits>;
  private readonly videoKeys: string[];
  private readonly recordingIndexById = new Map<string, number>();
  private readonly fileOffsets: number[];
  private readonly virtualFiles = new Map<string, VirtualFile>();
  private readonly resolved = new Map<number, ResolvedFiles>();
  private readonly refused = new Map<number, EpisodeSetError>();
  private readonly pending = new Map<number, Promise<void>>();
  /** Recordings whose prefetch failed: never batched again, only resolved on their own. */
  private readonly prefetchFailed = new Set<number>();
  /** Episode the viewer last said it is reading (`focusEpisode`). */
  private focusedEpisode: number | null = null;
  private readonly refreshCoalescer = new Coalescer();
  private readonly urlChanges = new UrlChangeEmitter();
  private readonly proactiveRefresh: ProactiveRefreshTimer;
  private episodeTable: Promise<Uint8Array> | null = null;
  /** Number of `resolve` calls made (for diagnostics and tests). */
  resolveCalls = 0;

  constructor(manifest: EpisodeSetManifest, options: EpisodeSetOptions = {}) {
    this.manifest = manifest;
    this.options = options;
    this.limits = resolveSafetyLimits();
    this.videoKeys = validateEpisodeSetManifest(manifest, options);
    manifest.recordings.forEach((recording, index) =>
      this.recordingIndexById.set(recording.id, index),
    );

    // Global row offsets: recording r's rows start after every earlier
    // recording's last used row, so synthesized global indices never collide.
    const maxRow = new Array<number>(manifest.recordings.length).fill(0);
    for (const episode of manifest.episodes) {
      const r = this.recordingIndexById.get(episode.recordingId)!;
      maxRow[r] = Math.max(maxRow[r]!, episode.toRow);
    }
    this.fileOffsets = [];
    let offset = 0;
    for (const rows of maxRow) {
      this.fileOffsets.push(offset);
      offset += rows;
    }

    this.virtualFiles.set(INFO_PATH, { kind: 'info' });
    this.virtualFiles.set(TASKS_PATH, { kind: 'tasks' });
    this.virtualFiles.set(EPISODES_PATH, { kind: 'episodes' });
    manifest.recordings.forEach((_, r) => {
      this.virtualFiles.set(formatLeRobotPath(DATA_PATH, chunkOf(r)), {
        kind: 'data',
        recording: r,
      });
      for (const videoKey of this.videoKeys) {
        this.virtualFiles.set(
          formatLeRobotPath(VIDEO_PATH, { ...chunkOf(r), video_key: videoKey }),
          { kind: 'video', recording: r, videoKey },
        );
      }
    });

    // Recordings that arrive with signed files are resolved up front; a bad
    // layout is refused now, naming the recording.
    manifest.recordings.forEach((recording, r) => {
      if (recording.files) this.resolved.set(r, this.checkLayout(r, recording.files));
    });

    this.proactiveRefresh = new ProactiveRefreshTimer(
      () => this.earliestExpiry(),
      () => this.refresh(),
      () => this.hasRefresher() && this.urlChanges.size > 0,
    );
  }

  async exists(path: string): Promise<boolean> {
    return this.virtualFiles.has(normalizeLogicalPath(path));
  }

  async listPaths(): Promise<string[]> {
    return [...this.virtualFiles.keys()];
  }

  async readText(path: string, onProgress?: ProgressHandler): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path, onProgress));
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    const normalized = normalizeLogicalPath(path);
    const file = this.virtualFile(normalized);
    switch (file.kind) {
      case 'info':
        return new TextEncoder().encode(JSON.stringify(this.buildInfo(), null, 2));
      case 'tasks':
        return new TextEncoder().encode(this.buildTasksJsonl());
      case 'episodes':
        this.episodeTable ??= this.buildEpisodeTable();
        return this.episodeTable;
      default: {
        const res = await fetchWithRefresh(
          normalized,
          () => this.getRecordingUrl(file),
          this.recordingRefresher(),
        );
        return readResponseBytes(res, normalized, this.limits, onProgress);
      }
    }
  }

  /** Read part of a recording's file with an HTTP Range request (see `DataSource.readRange`). */
  async readRange(path: string, start: number, end?: number): Promise<ByteRangeResult> {
    const normalized = normalizeLogicalPath(path);
    const file = this.virtualFile(normalized);
    if (file.kind !== 'data' && file.kind !== 'video') {
      // Synthesized files live in memory; slice them like a Blob.
      const bytes = await this.readBytes(normalized);
      const from = start < 0 ? Math.max(0, bytes.length + start) : Math.min(start, bytes.length);
      const to =
        start < 0 || end === undefined ? bytes.length : Math.max(from, Math.min(end, bytes.length));
      return { bytes: bytes.subarray(from, to), start: from, size: bytes.length };
    }
    await this.ensureResolved(file.recording);
    return fetchByteRange(
      normalized,
      () => this.getRecordingUrl(file),
      this.recordingRefresher(),
      this.fileState(file).entry.sizeBytes ?? null,
      start,
      end,
      this.limits,
    );
  }

  async getObjectUrl(path: string): Promise<string> {
    const normalized = normalizeLogicalPath(path);
    const file = this.virtualFile(normalized);
    if (file.kind !== 'data' && file.kind !== 'video') {
      throw new Error(`No remote URL for synthesized file: ${path}`);
    }
    return this.getRecordingUrl(file);
  }

  clear(): void {
    this.proactiveRefresh.cancel();
    this.urlChanges.clear();
  }

  /** A consumer reports that the URL for `path` failed: refresh resolved recordings once. */
  async invalidateObjectUrl(_path: string): Promise<void> {
    if (this.hasRefresher()) await this.refresh();
  }

  subscribeUrlChanges(listener: (paths: readonly string[]) => void): () => void {
    return this.urlChanges.subscribe(listener, () => this.proactiveRefresh.reschedule());
  }

  /** Ids of recordings whose files are currently resolved. */
  resolvedRecordingIds(): string[] {
    return [...this.resolved.keys()].map((r) => this.manifest.recordings[r]!.id);
  }

  /**
   * Re-sign every resolved recording once (coalesced across callers) and
   * notify URL subscribers of the paths whose URL changed.
   */
  refresh(): Promise<void> {
    if (!this.hasRefresher()) return Promise.resolve();
    return this.refreshCoalescer.run(() => this.refreshNow());
  }

  private async refreshNow(): Promise<void> {
    const refresher = this.options.refresh ?? this.options.resolve;
    if (!refresher) return;
    const indices = [...this.resolved.keys()];
    const changed: string[] = [];
    for (let start = 0; start < indices.length; start += EPISODE_SET_RESOLVE_BATCH) {
      const batch = indices.slice(start, start + EPISODE_SET_RESOLVE_BATCH);
      const ids = batch.map((r) => this.manifest.recordings[r]!.id);
      const results = await refresher(ids);
      for (const result of results ?? []) {
        const r = this.recordingIndexById.get(result?.id);
        if (r === undefined || !this.resolved.has(r)) continue;
        const previous = this.resolved.get(r)!;
        const next = this.checkLayout(r, result.files);
        if (previous.data.entry.presignedUrl !== next.data.entry.presignedUrl) {
          changed.push(formatLeRobotPath(DATA_PATH, chunkOf(r)));
        }
        for (const videoKey of this.videoKeys) {
          if (
            previous.videos.get(videoKey)?.entry.presignedUrl !==
            next.videos.get(videoKey)?.entry.presignedUrl
          ) {
            changed.push(formatLeRobotPath(VIDEO_PATH, { ...chunkOf(r), video_key: videoKey }));
          }
        }
        this.resolved.set(r, next);
      }
    }
    this.urlChanges.emit(changed);
    this.proactiveRefresh.reschedule();
  }

  private hasRefresher(): boolean {
    return Boolean(this.options.refresh ?? this.options.resolve);
  }

  private recordingRefresher(): UrlRefresher | null {
    if (!this.hasRefresher()) return null;
    return {
      generation: () => this.refreshCoalescer.generation,
      refreshSince: (seen) => this.refreshCoalescer.runSince(seen, () => this.refreshNow()),
    };
  }

  private virtualFile(path: string): VirtualFile {
    const file = this.virtualFiles.get(path);
    if (!file) throw fileNotFoundError(path, 'episode set');
    return file;
  }

  private async getRecordingUrl(
    file: Extract<VirtualFile, { kind: 'data' | 'video' }>,
  ): Promise<string> {
    await this.ensureResolved(file.recording);
    let state = this.fileState(file);
    if (this.hasRefresher() && this.refreshCoalescer.shouldRefreshForExpiry(state.expiresAtMs)) {
      await this.refresh();
      state = this.fileState(file);
    }
    return state.entry.presignedUrl;
  }

  private fileState(file: Extract<VirtualFile, { kind: 'data' | 'video' }>): FileState {
    const files = this.resolved.get(file.recording)!;
    return file.kind === 'data' ? files.data : files.videos.get(file.videoKey)!;
  }

  private async ensureResolved(r: number): Promise<void> {
    const refusal = this.refused.get(r);
    if (refusal) throw refusal;
    if (this.resolved.has(r)) return;
    const inFlight = this.pending.get(r);
    if (inFlight) {
      await inFlight;
      return this.ensureResolved(r);
    }
    const resolve = this.options.resolve;
    const id = this.manifest.recordings[r]!.id;
    if (!resolve) {
      throw new EpisodeSetError(
        'RECORDING_RESOLVE_FAILED',
        `Recording ${id} has no files and no resolver`,
        { recordingId: id },
      );
    }
    // The selected recording and the next ones go in one call; when that call
    // fails, the selected recording is resolved on its own, so a failing
    // prefetch id never fails the episode the viewer asked for.
    const prefetch = this.prefetchCandidates(r);
    try {
      await this.resolveBatch([r, ...prefetch]);
    } catch (error) {
      if (prefetch.length === 0) throw this.resolveFailed(r, error);
      if (!this.resolved.has(r) && !this.refused.has(r)) {
        try {
          await this.resolveBatch([r]);
        } catch (retryError) {
          throw this.resolveFailed(r, retryError);
        }
      }
      // The selected recording resolves alone: a prefetch id broke the batch.
      for (const index of prefetch) if (!this.resolved.has(index)) this.prefetchFailed.add(index);
    }
    const refused = this.refused.get(r);
    if (refused) throw refused;
    if (!this.resolved.has(r)) {
      throw new EpisodeSetError(
        'RECORDING_RESOLVE_FAILED',
        `Recording ${id} could not be resolved: the resolver did not return it`,
        { recordingId: id },
      );
    }
  }

  /** Resolve `batch` in one resolver call; results outside the batch are ignored. */
  private async resolveBatch(batch: number[]): Promise<void> {
    const resolve = this.options.resolve!;
    const ids = batch.map((index) => this.manifest.recordings[index]!.id);
    const task = (async () => {
      this.resolveCalls += 1;
      const results = await resolve(ids);
      for (const result of results ?? []) {
        const index = this.recordingIndexById.get(result?.id);
        if (index === undefined || !batch.includes(index) || this.resolved.has(index)) continue;
        try {
          this.resolved.set(index, this.checkLayout(index, result.files));
          this.prefetchFailed.delete(index);
        } catch (error) {
          if (error instanceof EpisodeSetError) this.refused.set(index, error);
          else throw error;
        }
      }
    })();
    for (const index of batch) this.pending.set(index, task);
    try {
      await task;
    } finally {
      for (const index of batch) {
        if (this.pending.get(index) === task) this.pending.delete(index);
      }
    }
  }

  private resolveFailed(r: number, error: unknown): EpisodeSetError {
    const id = this.manifest.recordings[r]!.id;
    return new EpisodeSetError(
      'RECORDING_RESOLVE_FAILED',
      `Recording ${id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
      { recordingId: id, cause: error },
    );
  }

  focusEpisode(episodeIndex: number): void {
    if (Number.isInteger(episodeIndex) && episodeIndex >= 0) this.focusedEpisode = episodeIndex;
  }

  /**
   * Recordings of the episodes after the focused episode when it belongs to
   * `r`, else after the first episode of `r` (distinct, unresolved, not
   * known to fail).
   */
  private prefetchCandidates(r: number): number[] {
    const id = this.manifest.recordings[r]!.id;
    const episodes = this.manifest.episodes;
    const focused = this.focusedEpisode;
    const first =
      focused != null && episodes[focused]?.recordingId === id
        ? focused
        : episodes.findIndex((episode) => episode.recordingId === id);
    const out: number[] = [];
    for (let k = first + 1; k < episodes.length && out.length < PREFETCH_RECORDINGS; k++) {
      const index = this.recordingIndexById.get(episodes[k]!.recordingId)!;
      if (index === r || out.includes(index)) continue;
      if (this.resolved.has(index) || this.pending.has(index) || this.refused.has(index)) continue;
      if (this.prefetchFailed.has(index)) continue;
      if (out.length + 1 >= EPISODE_SET_RESOLVE_BATCH) break;
      out.push(index);
    }
    return out;
  }

  /** Accept only a one-episode v3 tree: one data parquet, one video per camera. */
  private checkLayout(r: number, files: RemoteFileEntry[] | undefined): ResolvedFiles {
    const recording = this.manifest.recordings[r]!;
    const refuse = (reason: string): never => {
      throw new EpisodeSetError(
        'RECORDING_LAYOUT_REFUSED',
        `Recording ${recording.id} is not a one-episode LeRobot v3 tree: ${reason}`,
        { recordingId: recording.id },
      );
    };
    if (!Array.isArray(files)) return refuse('no file list');
    const byPath = new Map<string, FileState>();
    for (const file of files) {
      let path: string;
      try {
        path = validateUntrustedPath(file.logicalPath, this.limits);
        validateManifestUrl(file.presignedUrl, this.limits, path);
      } catch (error) {
        if (error instanceof DataSourceSafetyError) return refuse(error.message);
        throw error;
      }
      byPath.set(path, { entry: file, expiresAtMs: parseExpiresAt(file.expiresAt) });
    }
    const template =
      recording.previewVideoPath === undefined
        ? this.options.previewVideoPath
        : recording.previewVideoPath;
    const previews = new Map<string, FileState>();
    if (template) {
      for (const videoKey of this.videoKeys) {
        const previewPath = normalizeLogicalPath(
          formatLeRobotPath(template, { video_key: videoKey }),
        );
        const preview = byPath.get(previewPath);
        if (preview) {
          previews.set(videoKey, preview);
          byPath.delete(previewPath);
        }
      }
    }
    const dataFiles = [...byPath.keys()].filter((path) => /^data\/.+\.parquet$/.test(path));
    if (dataFiles.length !== 1) {
      return refuse(`expected one data parquet, found ${dataFiles.length}`);
    }
    const videos = new Map<string, FileState>();
    for (const videoKey of this.videoKeys) {
      const prefix = `videos/${videoKey}/`;
      const cameraFiles = [...byPath.keys()].filter(
        (path) => path.startsWith(prefix) && path.endsWith('.mp4'),
      );
      if (cameraFiles.length !== 1) {
        return refuse(`expected one video for ${videoKey}, found ${cameraFiles.length}`);
      }
      videos.set(videoKey, previews.get(videoKey) ?? byPath.get(cameraFiles[0]!)!);
    }
    return { data: byPath.get(dataFiles[0]!)!, videos };
  }

  private earliestExpiry(): number | null {
    let earliest: number | null = null;
    for (const files of this.resolved.values()) {
      for (const state of [files.data, ...files.videos.values()]) {
        if (state.expiresAtMs != null && (earliest == null || state.expiresAtMs < earliest)) {
          earliest = state.expiresAtMs;
        }
      }
    }
    return earliest;
  }

  private taskIndex(): Map<string, number> {
    const tasks = new Map<string, number>();
    for (const episode of this.manifest.episodes) {
      if (!tasks.has(episode.task)) tasks.set(episode.task, tasks.size);
    }
    return tasks;
  }

  private buildInfo(): Record<string, unknown> {
    const totalFrames = this.manifest.episodes.reduce(
      (sum, episode) => sum + (episode.toRow - episode.fromRow),
      0,
    );
    return {
      codebase_version: 'v3.0',
      robot_type: this.manifest.robotType ?? null,
      total_episodes: this.manifest.episodes.length,
      total_frames: totalFrames,
      total_tasks: this.taskIndex().size,
      chunks_size: CHUNKS_SIZE,
      fps: this.manifest.fps,
      splits: { train: `0:${this.manifest.episodes.length}` },
      data_path: DATA_PATH,
      video_path: this.videoKeys.length > 0 ? VIDEO_PATH : null,
      features: this.manifest.features,
    };
  }

  private buildTasksJsonl(): string {
    return [...this.taskIndex().entries()]
      .map(([task, taskIndex]) => JSON.stringify({ task_index: taskIndex, task }))
      .join('\n');
  }

  /** The episode table as an Arrow IPC file (read by the loader without the Parquet parser). */
  private async buildEpisodeTable(): Promise<Uint8Array> {
    const arrow = await import('apache-arrow');
    const episodes = this.manifest.episodes;
    const n = episodes.length;
    const tasks = this.taskIndex();
    const columns: Record<string, import('apache-arrow').Vector> = {};
    const int = (values: number[]) => arrow.vectorFromArray(Int32Array.from(values));
    const float = (values: Array<number | null>) =>
      arrow.vectorFromArray(values, new arrow.Float64());

    const recordingOf = episodes.map((episode) =>
      this.recordingIndexById.get(episode.recordingId)!,
    );
    columns.episode_index = int(episodes.map((_, k) => k));
    columns.task_index = int(episodes.map((episode) => tasks.get(episode.task)!));
    columns.length = int(episodes.map((episode) => episode.toRow - episode.fromRow));
    columns['data/chunk_index'] = int(recordingOf.map((r) => chunkOf(r).chunk_index));
    columns['data/file_index'] = int(recordingOf.map((r) => chunkOf(r).file_index));
    columns.dataset_from_index = float(
      episodes.map((episode, k) => this.fileOffsets[recordingOf[k]!]! + episode.fromRow),
    );
    columns.dataset_to_index = float(
      episodes.map((episode, k) => this.fileOffsets[recordingOf[k]!]! + episode.toRow),
    );
    columns['data/file_from_index'] = float(recordingOf.map((r) => this.fileOffsets[r]!));
    for (const videoKey of this.videoKeys) {
      columns[`videos/${videoKey}/chunk_index`] = int(
        recordingOf.map((r) => chunkOf(r).chunk_index),
      );
      columns[`videos/${videoKey}/file_index`] = int(recordingOf.map((r) => chunkOf(r).file_index));
      columns[`videos/${videoKey}/from_timestamp`] = float(
        episodes.map((episode) => episode.fromS),
      );
      columns[`videos/${videoKey}/to_timestamp`] = float(episodes.map((episode) => episode.toS));
    }
    const metaKeys = [...new Set(episodes.flatMap((episode) => Object.keys(episode.meta ?? {})))];
    for (const key of metaKeys) {
      const values = episodes.map((episode) => episode.meta?.[key] ?? null);
      const numeric = values.every((value) => value === null || typeof value === 'number');
      columns[key] = numeric
        ? float(values as Array<number | null>)
        : arrow.vectorFromArray(
            values.map((value) => (value === null ? null : String(value))),
            new arrow.Utf8(),
          );
    }
    const table = new arrow.Table(columns);
    if (table.numRows !== n) throw new Error('Episode table row count mismatch');
    return arrow.tableToIPC(table, 'file');
  }
}

/** Validate the manifest; returns the video feature keys. */
function validateEpisodeSetManifest(
  manifest: EpisodeSetManifest,
  options: EpisodeSetOptions,
): string[] {
  const invalid = (message: string, recordingId?: string): never => {
    throw new EpisodeSetError('MANIFEST_INVALID', message, { recordingId });
  };
  if (!manifest || typeof manifest !== 'object') return invalid('Episode set manifest is missing');
  if (typeof manifest.fps !== 'number' || !(manifest.fps > 0)) {
    return invalid('Episode set fps must be a positive number');
  }
  if (!manifest.features || typeof manifest.features !== 'object') {
    return invalid('Episode set features must be an object');
  }
  if (!Array.isArray(manifest.recordings) || !Array.isArray(manifest.episodes)) {
    return invalid('Episode set recordings and episodes must be arrays');
  }
  if (manifest.recordings.length > CHUNKS_SIZE * CHUNKS_SIZE) {
    return invalid('Episode set has too many recordings');
  }
  const ids = new Set<string>();
  for (const recording of manifest.recordings) {
    if (!recording || typeof recording.id !== 'string' || recording.id.length === 0) {
      return invalid('Every recording needs a non-empty id');
    }
    if (ids.has(recording.id)) return invalid(`Duplicate recording ${recording.id}`, recording.id);
    ids.add(recording.id);
    if (!recording.files && !options.resolve) {
      return invalid(`Recording ${recording.id} has no files and no resolver`, recording.id);
    }
  }
  for (const [k, episode] of manifest.episodes.entries()) {
    if (!ids.has(episode?.recordingId)) {
      return invalid(`Episode ${k} references unknown recording ${String(episode?.recordingId)}`);
    }
    if (
      !isNonNegativeInteger(episode.fromRow) ||
      !isNonNegativeInteger(episode.toRow) ||
      episode.toRow <= episode.fromRow
    ) {
      return invalid(`Episode ${k} has an invalid row range`, episode.recordingId);
    }
    if (
      !Number.isFinite(episode.fromS) ||
      !Number.isFinite(episode.toS) ||
      episode.fromS < 0 ||
      episode.toS < episode.fromS
    ) {
      return invalid(`Episode ${k} has an invalid time range`, episode.recordingId);
    }
    for (const key of Object.keys(episode.meta ?? {})) {
      if (RESERVED_COLUMNS.has(key) || RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        return invalid(
          `Episode meta key ${key} collides with a LeRobot column`,
          episode.recordingId,
        );
      }
    }
  }
  return Object.entries(manifest.features)
    .filter(([, feature]) => (feature as { dtype?: unknown } | null)?.dtype === 'video')
    .map(([key]) => key);
}
