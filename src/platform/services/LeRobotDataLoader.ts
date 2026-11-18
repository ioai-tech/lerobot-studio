import type {
  LeRobotInfo,
  EpisodeMetadata,
  FrameData,
  NumericalColumnData,
  NumericalColumnMap,
  ParquetWorkerAPI,
  EpisodeDataPathResult,
  EpisodeVideoPathResult,
  LeRobotVersionAdapter,
  ValidationReport,
  LeRobotVersionCapability,
  SubtaskTable,
} from '@/core';
import {
  classifyLeRobotVersion,
  getAdapterForVersion,
  getValidatorForVersion,
  hasBlockingValidationError,
  buildSubtaskTable,
  indicesFromFrameLabels,
  tableFromSubtaskIndices,
  NON_BLOCKING_VALIDATION_CODES,
  normalizeSubtaskIndex,
  normalizeSubtaskLabel,
  resolveSubtaskIndexFeatureKey,
  resolveSubtaskLabelFeatureKey,
} from '@/core';
import { tableFromIPC, Table } from 'apache-arrow';
import { LRUCache } from '../utils/MediaCache';
import type { DataSource } from '../datasource/dataSources';
import { proxy, type Remote } from 'comlink';
import { createParquetWorker, terminateWorker } from '../workers/workerManager';
import {
  ParquetRangeReader,
  RangeFallback,
  type ParquetRangeFallbackReason,
  type PreparedRangedRead,
} from './parquetRangeReader';

export type { NumericalColumnData, NumericalColumnMap };

const ARROW_FILE_MAGIC = [0x41, 0x52, 0x52, 0x4f, 0x57, 0x31]; // "ARROW1"

/** True when bytes are an Arrow IPC file (magic `ARROW1`). */
export function isArrowIpc(bytes: Uint8Array): boolean {
  if (bytes.byteLength < ARROW_FILE_MAGIC.length) return false;
  return ARROW_FILE_MAGIC.every((value, index) => bytes[index] === value);
}

/** Keep only the episodes a scoped source asks for (all when unscoped). */
export function filterEpisodesToScope<T extends { episode_index: number }>(
  episodes: T[],
  scope: readonly number[] | undefined,
): T[] {
  if (!scope) return episodes;
  const allowed = new Set(scope);
  return episodes.filter((episode) => allowed.has(Number(episode.episode_index)));
}

// 文件缓存结构
interface ParsedFileCache {
  path: string;
  columns: string[] | null;
  table: Table;
  arrowData: Uint8Array;
}

interface FileBytesCache {
  path: string;
  bytes: Uint8Array;
}

/** Metadata files read at once while a dataset opens. */
const METADATA_READS_IN_FLIGHT = 6;

export class LeRobotDataLoader {
  private _dataSource: DataSource;
  private info?: LeRobotInfo;
  private adapter: LeRobotVersionAdapter | null = null;
  private episodes: EpisodeMetadata[] = [];
  private tasks: Record<number, string> = {};
  private subtasks: SubtaskTable = {};
  private worker: Remote<ParquetWorkerAPI>;
  private fileUrlCache: LRUCache<string, string>;
  private disposed = false;
  private validationReport: ValidationReport | null = null;
  private versionCapability: LeRobotVersionCapability = {
    status: 'unsupported',
    normalizedVersion: null,
    adapterVersion: null,
  };

  // 文件解析缓存 - 避免重复读取和解析同一个文件
  private parsedFileCache: ParsedFileCache | null = null;
  private fileBytesCache: FileBytesCache | null = null;
  private pendingParses: Map<string, Promise<Table>> = new Map();
  /**
   * While `initialize` runs: metadata files read concurrently (by path) and
   * each metadata table parsed once (by path and columns), shared by the
   * validator and the adapter. Cleared when `initialize` ends.
   */
  private metadataBytes: Map<string, Promise<Uint8Array>> | null = null;
  private metadataTables: Map<string, Promise<Uint8Array>> | null = null;
  private fileUrlLoading: Map<string, Promise<string>> = new Map();
  private readonly urlChangeListeners = new Set<(paths: readonly string[]) => void>();
  private unsubscribeSourceUrls: (() => void) | null = null;
  private readonly rangeReader: ParquetRangeReader;
  private readonly reportedFallbacks = new Set<ParquetRangeFallbackReason>();

  constructor(dataSource: DataSource) {
    this._dataSource = dataSource;
    this.rangeReader = new ParquetRangeReader(dataSource);
    // 使用 Vite ?worker&inline 自动处理 worker 和 WASM
    this.worker = createParquetWorker();
    // blob URL 由 DataSource 创建与 revoke；本层仅做 path→URL 查表，避免双层 LRU 互相 revoke 导致失效 URL
    this.fileUrlCache = new LRUCache<string, string>(50, false);
    this.unsubscribeSourceUrls =
      dataSource.subscribeUrlChanges?.((paths) => this.handleSourceUrlChanges(paths)) ?? null;
  }

  /**
   * Subscribe to URL replacements for files this loader has handed out (for
   * example refreshed signed URLs). The loader's URL cache is already updated
   * when listeners run; call `getFileUrl` again to get the new URL.
   */
  subscribeUrlChanges(listener: (paths: readonly string[]) => void): () => void {
    this.urlChangeListeners.add(listener);
    return () => {
      this.urlChangeListeners.delete(listener);
    };
  }

  private handleSourceUrlChanges(paths: readonly string[]): void {
    for (const path of paths) {
      this.fileUrlCache.delete(path);
      this.fileUrlLoading.delete(path);
    }
    for (const listener of [...this.urlChangeListeners]) {
      try {
        listener(paths);
      } catch (error) {
        console.error('URL change listener failed', error);
      }
    }
  }

  get dataSource(): DataSource {
    return this._dataSource;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSourceUrls?.();
    this.unsubscribeSourceUrls = null;
    this.urlChangeListeners.clear();
    try {
      this.fileUrlCache.clear();
      this.fileUrlLoading.clear();
      this.pendingParses.clear();
    } catch {
      // ignore
    }
    try {
      await this.worker.clearCache();
    } catch {
      // ignore
    } finally {
      try {
        terminateWorker(this.worker);
      } catch {
        // ignore
      }
    }
    try {
      await this._dataSource.clear();
    } catch {
      // ignore
    }
  }

  async initialize(): Promise<LeRobotInfo> {
    try {
      const infoText = await this._dataSource.readText('meta/info.json');
      try {
        this.info = JSON.parse(infoText) as LeRobotInfo;
      } catch (e) {
        throw new Error(
          `Failed to parse meta/info.json: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      this.versionCapability = classifyLeRobotVersion(this.info.codebase_version);
      if (this.versionCapability.status === 'unsupported') {
        throw new Error(
          `Unsupported LeRobot codebase_version: ${String(this.info.codebase_version ?? 'missing')}`,
        );
      }

      this.adapter = getAdapterForVersion(this.info.codebase_version);
      const helpers = {
        readParquetToIPC: (path: string, columns?: string[]) =>
          this.readParquetByPath(path, columns),
      };

      // No waterfall: every metadata file is requested now, together; the
      // validator and the adapter then read them from these requests.
      this.metadataBytes = new Map();
      this.metadataTables = new Map();
      await this.prefetchMetadata();
      const adapter = this.adapter;
      const validator = getValidatorForVersion(this.info.codebase_version);
      const report = await validator.validate(this._dataSource, this.info, helpers);
      this.validationReport = report;
      if (hasBlockingValidationError(report)) {
        const messages = report.items
          .filter((i) => i.level === 'error' && !NON_BLOCKING_VALIDATION_CODES.has(i.code ?? ''))
          .map((i) => i.message);
        throw new Error(`数据集格式校验未通过: ${messages.join('; ')}`);
      }

      // A blocked dataset loads nothing more; otherwise episodes, tasks and
      // subtasks parse side by side from the bytes already on their way (the
      // validator's episodes table is reused).
      const [episodes, tasks, subtasks] = await Promise.all([
        adapter.loadEpisodes(this._dataSource, helpers, this.info),
        adapter.loadTasks(this._dataSource, helpers),
        adapter.loadSubtasks ? adapter.loadSubtasks(this._dataSource, helpers) : {},
      ]);
      this.episodes = filterEpisodesToScope(episodes, this._dataSource.episodeScope);
      this.tasks = tasks;
      this.subtasks = subtasks;

      // v3: when episode metadata includes a scalar task_index, resolve the label from
      // meta/tasks.parquet. Official Python writers store per-episode labels in the
      // ``tasks`` list column only — there is often no episode-level ``task_index``.
      // Defaulting missing task_index to 0 incorrectly showed every episode as task 0.
      if (this.versionCapability.adapterVersion === 'v3.0') {
        this.episodes.forEach((ep) => {
          if (ep.task_index == null) return;
          const idx = Number(ep.task_index);
          if (!Number.isFinite(idx)) return;
          if (this.tasks[idx] !== undefined) {
            ep.tasks = [this.tasks[idx]];
          }
        });
      }
    } catch (e) {
      if (this.validationReport == null) {
        try {
          const validator = getValidatorForVersion('v3.0');
          const report = await validator.validate(this._dataSource, null, undefined);
          this.validationReport = report;
        } catch (validationError) {
          console.warn('Failed to run format validator for error report', validationError);
        }
      }
      if (e instanceof Error) {
        if (e.name === 'NotFoundError') {
          throw new Error('Not a valid LeRobot dataset: meta/info.json not found');
        }
        throw e;
      }
      throw new Error(`Failed to initialize: ${String(e)}`);
    } finally {
      this.metadataBytes = null;
      this.metadataTables = null;
    }

    return this.info!;
  }

  /**
   * Request the metadata files the adapter reads (v3: every
   * `meta/episodes` shard, `meta/tasks.parquet`, `meta/subtasks.parquet`)
   * at once. Only files the source has are requested; a failed read is
   * reported where the adapter reads it, as before.
   */
  private async prefetchMetadata(): Promise<void> {
    if (!this.metadataBytes || this.versionCapability?.adapterVersion !== 'v3.0') return;
    const listed = this._dataSource.listPaths
      ? await this._dataSource.listPaths().catch(() => null)
      : null;
    const candidates = listed
      ? listed.filter(
          (path) =>
            /^meta\/episodes\/chunk-\d+\/file-\d+\.parquet$/.test(path) ||
            path === 'meta/tasks.parquet' ||
            path === 'meta/subtasks.parquet',
        )
      : ['meta/episodes/chunk-000/file-000.parquet', 'meta/tasks.parquet', 'meta/subtasks.parquet'];
    const present = await Promise.all(
      candidates.map(async (path) =>
        listed ? path : (await this._dataSource.exists(path).catch(() => false)) ? path : null,
      ),
    );
    // At most METADATA_READS_IN_FLIGHT at once: a dataset with hundreds of
    // episode shards does not open hundreds of requests.
    let inFlight = 0;
    const waiting: Array<() => void> = [];
    const slot = () =>
      inFlight < METADATA_READS_IN_FLIGHT
        ? (inFlight++, Promise.resolve())
        : new Promise<void>((resolve) => waiting.push(resolve)).then(() => void inFlight++);
    const done = () => {
      inFlight--;
      waiting.shift()?.();
    };
    for (const path of present) {
      if (!path) continue;
      const read = slot().then(() => this._dataSource.readBytes(path).finally(done));
      read.catch(() => undefined);
      this.metadataBytes.set(path, read);
    }
  }

  /**
   * 获取解析后的表（带缓存）
   */
  private async getParsedTable(path: string, columns?: string[]): Promise<Table> {
    const normalizedColumns = this.normalizeColumns(columns);
    const requestKey = this.getParseRequestKey(path, normalizedColumns);

    // 如果缓存包含本次请求所需的列，直接返回
    if (this.canReuseParsedTable(path, normalizedColumns)) {
      return this.parsedFileCache!.table;
    }

    // 如果正在解析同一个请求，等待进行中的解析。
    const pending = this.pendingParses.get(requestKey);
    if (pending) {
      return pending;
    }

    // 开始新的解析
    const parsePromise = this.parseFile(path, normalizedColumns ?? undefined);
    this.pendingParses.set(requestKey, parsePromise);

    try {
      return await parsePromise;
    } finally {
      if (this.pendingParses.get(requestKey) === parsePromise) {
        this.pendingParses.delete(requestKey);
      }
    }
  }

  private normalizeColumns(columns?: string[]): string[] | null {
    if (!columns || columns.length === 0) return null;
    return Array.from(new Set(columns)).sort();
  }

  private getParseRequestKey(path: string, columns: string[] | null): string {
    return `${path}::${columns ? columns.join(',') : '*'}`;
  }

  private canReuseParsedTable(path: string, requestedColumns: string[] | null): boolean {
    if (!this.parsedFileCache || this.parsedFileCache.path !== path) {
      return false;
    }

    if (this.parsedFileCache.columns === null) {
      return true;
    }

    if (requestedColumns === null) {
      return false;
    }

    const cachedColumns = new Set(this.parsedFileCache.columns);
    return requestedColumns.every((column) => cachedColumns.has(column));
  }

  private async parseFile(path: string, columns?: string[]): Promise<Table> {
    const bytes = await this.readFileBytesCached(path);
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const arrowData = await this.worker.readParquet(buffer, columns);
    const table = tableFromIPC(arrowData);
    this.parsedFileCache = {
      path,
      columns: this.normalizeColumns(columns),
      table,
      arrowData,
    };
    return table;
  }

  /**
   * Parse parquet bytes that are not part of the dataset (for example an
   * auxiliary series) with this loader's parquet worker; returns Arrow IPC.
   */
  async parseParquet(bytes: Uint8Array, columns?: string[]): Promise<Uint8Array> {
    if (isArrowIpc(bytes)) return bytes;
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return this.worker.readParquet(buffer, columns);
  }

  private readParquetByPath(path: string, columns?: string[]): Promise<Uint8Array> {
    const tables = this.metadataTables;
    if (!tables) return this.parseParquetByPath(path, columns);
    const key = `${path}\u0000${columns?.join('\u0000') ?? '*'}`;
    let table = tables.get(key);
    if (!table) {
      table = this.parseParquetByPath(path, columns);
      tables.set(key, table);
    }
    return table;
  }

  private async parseParquetByPath(path: string, columns?: string[]): Promise<Uint8Array> {
    const bytes = await this.readFileBytesCached(path);
    // Metadata tables may also be Arrow IPC (sources that synthesize metadata,
    // such as episode sets, produce IPC directly); Arrow reads it as-is.
    if (isArrowIpc(bytes)) return bytes;
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return await this.worker.readParquet(buffer, columns);
  }

  private async readFileBytesCached(path: string): Promise<Uint8Array> {
    const prefetched = this.metadataBytes?.get(path);
    if (prefetched) return prefetched;
    if (this.fileBytesCache?.path === path) {
      return this.fileBytesCache.bytes;
    }

    const bytes = await this._dataSource.readBytes(path);
    this.fileBytesCache = {
      path,
      bytes,
    };
    return bytes;
  }

  /**
   * Numeric columns of one episode. When the source reads ranges, only the
   * parquet footer and the selected columns' chunks of the row groups holding
   * the episode are fetched; otherwise (or on a named fallback) the file whole.
   * `onFetched` runs once the bytes are in, before decoding, so a caller can
   * start the next read while this one decodes.
   */
  async loadAllNumericalData(
    episodeIndex: number,
    columns: string[],
    options: { onFetched?: () => void } = {},
  ): Promise<NumericalColumnMap> {
    if (!this.info) throw new Error('Not initialized');
    if (columns.length === 0) {
      options.onFetched?.();
      return {};
    }

    const { path, start, end } = this.getEpisodeRange(episodeIndex);
    let fetched = false;
    const onFetched = () => {
      if (fetched) return;
      fetched = true;
      options.onFetched?.();
    };
    const result = await this.readRangedOrWhole(
      path,
      columns,
      start,
      end,
      (prepared) => {
        onFetched();
        if (prepared.read.limit === 0) {
          return Promise.resolve(
            Object.fromEntries(
              columns.map((column) => [column, { values: new ArrayBuffer(0), rows: 0, width: 1 }]),
            ),
          );
        }
        return this.worker.readNumericColumnsRanged(
          prepared.source,
          proxy(prepared.fetchRange),
          prepared.read,
        );
      },
      (buffer) => {
        onFetched();
        return this.worker.readNumericColumns(buffer, columns, start, end);
      },
    );

    return Object.fromEntries(
      Object.entries(result).map(([column, data]) => [
        column,
        {
          values: new Float64Array(data.values),
          rows: data.rows,
          width: data.width,
        },
      ]),
    );
  }

  /**
   * How episode columns are read: `range` (footer and column chunks), or
   * `whole-file` with the named reason when ranges were tried and refused.
   */
  getRangeReadStatus(): {
    mode: 'range' | 'whole-file';
    reason: ParquetRangeFallbackReason | null;
  } {
    if (typeof this._dataSource.readRange !== 'function')
      return { mode: 'whole-file', reason: null };
    const reason = this.rangeReader.refusal;
    return reason ? { mode: 'whole-file', reason } : { mode: 'range', reason: null };
  }

  /**
   * Read by range when possible, else the file whole. A decoder read that
   * meets a new version of the file (`FILE_CHANGED`) is planned again once,
   * from the new footer; if the file changes again, it is read whole, by name.
   */
  private async readRangedOrWhole<T>(
    path: string,
    columns: string[],
    start: number,
    end: number,
    ranged: (prepared: PreparedRangedRead) => Promise<T>,
    whole: (buffer: ArrayBuffer) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const prepared = await this.prepareRangedRead(path, columns, start, end);
      if (!prepared) return this.readWholeFile(path, whole);
      try {
        return await ranged(prepared);
      } catch (error) {
        if (!this.rangeReader.takeChanged(path)) throw error;
        if (attempt === 0) continue;
        this.reportFallback('FILE_CHANGED', path);
        // The current version, read fresh.
        if (this.fileBytesCache?.path === path) this.fileBytesCache = null;
        return this.readWholeFile(path, whole);
      }
    }
  }

  /** Warn once per reason that a file is read whole instead of by range. */
  private reportFallback(reason: ParquetRangeFallbackReason, path: string): void {
    if (this.reportedFallbacks.has(reason)) return;
    this.reportedFallbacks.add(reason);
    console.warn(`[lerobot-studio] ${reason}: reading ${path} whole instead of by range`);
  }

  private async prepareRangedRead(
    path: string,
    columns: string[],
    start: number,
    end: number,
  ): Promise<PreparedRangedRead | null> {
    if (!this.rangeReader.available) return null;
    try {
      return await this.rangeReader.prepare(path, columns, start, end);
    } catch (error) {
      if (!(error instanceof RangeFallback)) throw error;
      this.reportFallback(error.reason, path);
      if (error.wholeFile) this.fileBytesCache = { path, bytes: error.wholeFile };
      return null;
    }
  }

  private async readWholeFile<T>(
    path: string,
    read: (buffer: ArrayBuffer) => Promise<T>,
  ): Promise<T> {
    const bytes = await this.readFileBytesCached(path);
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return read(buffer);
  }

  private getEpisodeRange(episodeIndex: number): { path: string; start: number; end: number } {
    if (!this.info || !this.adapter) throw new Error('Not initialized');

    this._dataSource.focusEpisode?.(episodeIndex);
    const result = this.adapter.getEpisodeDataPath(this.info, this.episodes, episodeIndex);
    if (!result) throw new Error(`Episode ${episodeIndex} not found`);

    return {
      path: result.path,
      start: result.startRow,
      end: result.endRow,
    };
  }

  private async getEpisodeTable(
    episodeIndex: number,
    columns?: string[],
  ): Promise<{ table: Table; start: number; end: number; path: string }> {
    if (!this.info || !this.adapter) throw new Error('Not initialized');

    this._dataSource.focusEpisode?.(episodeIndex);
    const result = this.adapter.getEpisodeDataPath(this.info, this.episodes, episodeIndex);
    if (!result) throw new Error(`Episode ${episodeIndex} not found`);

    const table = await this.getParsedTable(result.path, columns);
    const end = result.endRow === 0 ? table.numRows : result.endRow;
    return {
      table,
      start: result.startRow,
      end,
      path: result.path,
    };
  }

  async loadFeatureData(
    episodeIndex: number,
    featureNames: string[],
  ): Promise<Record<string, unknown[]>> {
    if (!this.info) throw new Error('Not initialized');
    if (featureNames.length === 0) return {};

    const { path, start, end } = this.getEpisodeRange(episodeIndex);
    return this.readRangedOrWhole(
      path,
      featureNames,
      start,
      end,
      (prepared) =>
        prepared.read.limit === 0
          ? Promise.resolve(Object.fromEntries(featureNames.map((name) => [name, []])))
          : this.worker.readFeatureDataRanged(
              prepared.source,
              proxy(prepared.fetchRange),
              prepared.read,
            ),
      (buffer) => this.worker.readFeatureData(buffer, featureNames, start, end),
    );
  }

  getEpisodes() {
    return this.episodes;
  }

  getTasks() {
    return this.tasks;
  }

  getSubtasks(): SubtaskTable {
    return this.subtasks;
  }

  /**
   * Per-frame source subtask_index values for one episode.
   * Missing column returns []; invalid / -1 values become null.
   */
  async loadEpisodeSubtaskIndices(episodeIndex: number): Promise<Array<number | null>> {
    const source = await this.loadEpisodeSubtaskSource(episodeIndex);
    return source.indices;
  }

  /**
   * Load frame-level subtask indices and the label table for one episode.
   * Prefers per-frame label columns (`metadata.subtask_label`) when present so
   * PI-style v2 datasets without meta/subtasks.parquet still display segments.
   */
  async loadEpisodeSubtaskSource(episodeIndex: number): Promise<{
    indices: Array<number | null>;
    table: SubtaskTable;
  }> {
    if (!this.info) throw new Error('Not initialized');
    const indexKey = resolveSubtaskIndexFeatureKey(this.info.features);
    const labelKey = resolveSubtaskLabelFeatureKey(this.info.features);
    if (!indexKey && !labelKey && Object.keys(this.subtasks).length === 0) {
      return { indices: [], table: this.subtasks };
    }

    let labels: string[] = [];
    if (labelKey) {
      try {
        const data = await this.loadFeatureData(episodeIndex, [labelKey]);
        labels = (data[labelKey] ?? []).map((value) => normalizeSubtaskLabel(value));
      } catch {
        labels = [];
      }
    }
    if (labels.some((label) => label.length > 0)) {
      const table = { ...this.subtasks, ...buildSubtaskTable(labels) };
      return { indices: indicesFromFrameLabels(labels, table), table };
    }

    if (!indexKey) return { indices: [], table: this.subtasks };
    try {
      const data = await this.loadAllNumericalData(episodeIndex, [indexKey]);
      const column = data[indexKey];
      if (!column) return { indices: [], table: this.subtasks };
      const indices = Array.from({ length: column.rows }, (_, row) =>
        normalizeSubtaskIndex(column.values[row * column.width]),
      );
      return {
        indices,
        table: tableFromSubtaskIndices(indices, this.subtasks),
      };
    } catch {
      return { indices: [], table: this.subtasks };
    }
  }

  /**
   * Returns the format validation report from the last initialize() run.
   * Use for UI to show info/warning/error messages; null if not yet initialized or no validation ran.
   */
  getValidationReport(): ValidationReport | null {
    return this.validationReport;
  }

  getVersionCapability(): LeRobotVersionCapability {
    return { ...this.versionCapability };
  }

  /**
   * Returns the Arrow table for a single episode (for export).
   * When episode is a slice of a shared file (e.g. v3), returns sliced table; otherwise full table.
   */
  async getEpisodeTableForExport(
    episodeIndex: number,
  ): Promise<{ table: Table; pathHint: string }> {
    const { table, start, end, path } = await this.getEpisodeTable(episodeIndex, undefined);
    if (start > 0 || end < table.numRows) {
      return { table: table.slice(start, end), pathHint: path };
    }
    return { table, pathHint: path };
  }

  /**
   * Version-agnostic: path and row range for this episode's data Parquet.
   * Used by ImagePanel and export. Returns null if episode not found.
   */
  getEpisodeDataPath(episodeIndex: number): EpisodeDataPathResult | null {
    if (!this.info || !this.adapter) return null;
    this._dataSource.focusEpisode?.(episodeIndex);
    return this.adapter.getEpisodeDataPath(this.info, this.episodes, episodeIndex);
  }

  /**
   * Version-agnostic: path and optional time range for this episode's video feature.
   * Used by VideoPanel and export. Returns null if not found.
   */
  getEpisodeVideoPath(episodeIndex: number, featureKey: string): EpisodeVideoPathResult | null {
    if (!this.info || !this.adapter) return null;
    this._dataSource.focusEpisode?.(episodeIndex);
    return this.adapter.getEpisodeVideoPath(this.info, this.episodes, episodeIndex, featureKey);
  }

  async loadEpisodeData(episodeIndex: number, columns?: string[]): Promise<FrameData[]> {
    if (!this.info) throw new Error('Not initialized');

    const { table, start, end } = await this.getEpisodeTable(episodeIndex, columns);

    const frames: FrameData[] = [];
    const fields = table.schema.fields;

    for (let i = start; i < end; i++) {
      const frame: Record<string, unknown> = {
        frame_index: 0,
        timestamp: 0,
      };
      fields.forEach((field) => {
        let val: unknown = table.getChild(field.name)?.get(i);

        // 转换 BigInt 为 Number
        if (typeof val === 'bigint') {
          val = Number(val);
        }

        // 转换 Arrow 数组类型为普通 JavaScript 数组
        if (val && typeof val === 'object') {
          const obj = val as { constructor: { name: string }; toArray?: () => unknown[] };
          if (obj.constructor.name.includes('Array') || 'toArray' in obj) {
            val = Array.from(val as Iterable<unknown>);
            // 将数组中的 BigInt 也转换为 Number
            if (Array.isArray(val)) {
              val = val.map((v) => (typeof v === 'bigint' ? Number(v) : v));
            }
          }
        }

        frame[field.name] = val;
      });
      frames.push(frame as FrameData);
    }

    return frames;
  }

  async getFileUrl(path: string): Promise<string> {
    const cachedUrl = this.fileUrlCache.get(path);
    if (cachedUrl) {
      return cachedUrl;
    }

    const pending = this.fileUrlLoading.get(path);
    if (pending) {
      return pending;
    }

    const promise = (async () => {
      const url = await this._dataSource.getObjectUrl(path);
      this.fileUrlCache.set(path, url);
      return url;
    })();
    this.fileUrlLoading.set(path, promise);

    try {
      return await promise;
    } finally {
      this.fileUrlLoading.delete(path);
    }
  }

  /**
   * 丢弃某路径的 URL 缓存并让 DataSource 释放对应 blob（若支持）。
   * 用于视频播放命中已 revoke 的 blob URL 后的恢复。
   */
  async invalidateFileUrl(path: string): Promise<void> {
    this.fileUrlCache.delete(path);
    this.fileUrlLoading.delete(path);
    await this._dataSource.invalidateObjectUrl?.(path);
  }

  /**
   * Read file as bytes without using blob URL cache. Use for export so blob URLs
   * are not evicted by the loader's LRU cache during long-running transcode.
   */
  async readFileBytes(path: string): Promise<Uint8Array> {
    return this._dataSource.readBytes(path);
  }

  clearCache(): void {
    this.fileUrlCache.clear();
    this.fileUrlLoading.clear();
    this.pendingParses.clear();
    this.parsedFileCache = null;
    this.fileBytesCache = null;
  }

  /**
   * 释放当前文件的字节缓存与 Arrow 解析缓存，并通知 worker 清空其内部 fileCache。
   * 在切换 episode 到另一个数据文件时调用，避免旧文件的内存常驻导致叠加式 OOM。
   * 不释放 blob URL 缓存（切换 episode 时通常需要视频/图像 URL 命中）。
   */
  async releaseParsedCaches(): Promise<void> {
    this.parsedFileCache = null;
    this.fileBytesCache = null;
    this.rangeReader.clear();
    this.pendingParses.clear();
    try {
      await this.worker.clearCache();
    } catch {
      // ignore
    }
  }

  /** 仅当需要强制重新解析指定路径时使用 */
  isFileBytesCached(path: string): boolean {
    return this.fileBytesCache?.path === path || this.rangeReader.cachedPath() === path;
  }
}
