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
} from '@/core';
import {
  classifyLeRobotVersion,
  getAdapterForVersion,
  getValidatorForVersion,
  hasBlockingValidationError,
  NON_BLOCKING_VALIDATION_CODES,
} from '@/core';
import { tableFromIPC, Table } from 'apache-arrow';
import { LRUCache } from '../utils/MediaCache';
import type { DataSource } from '../datasource/dataSources';
import type { Remote } from 'comlink';
import { createParquetWorker, terminateWorker } from '../workers/workerManager';

export type { NumericalColumnData, NumericalColumnMap };

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

export class LeRobotDataLoader {
  private _dataSource: DataSource;
  private info?: LeRobotInfo;
  private adapter: LeRobotVersionAdapter | null = null;
  private episodes: EpisodeMetadata[] = [];
  private tasks: Record<number, string> = {};
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
  private fileUrlLoading: Map<string, Promise<string>> = new Map();

  constructor(dataSource: DataSource) {
    this._dataSource = dataSource;
    // 使用 Vite ?worker&inline 自动处理 worker 和 WASM
    this.worker = createParquetWorker();
    // blob URL 由 DataSource 创建与 revoke；本层仅做 path→URL 查表，避免双层 LRU 互相 revoke 导致失效 URL
    this.fileUrlCache = new LRUCache<string, string>(50, false);
  }

  get dataSource(): DataSource {
    return this._dataSource;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
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

      const validator = getValidatorForVersion(this.info.codebase_version);
      const report = await validator.validate(this._dataSource, this.info, helpers);
      this.validationReport = report;
      if (hasBlockingValidationError(report)) {
        const messages = report.items
          .filter((i) => i.level === 'error' && !NON_BLOCKING_VALIDATION_CODES.has(i.code ?? ''))
          .map((i) => i.message);
        throw new Error(`数据集格式校验未通过: ${messages.join('; ')}`);
      }

      this.episodes = await this.adapter.loadEpisodes(this._dataSource, helpers, this.info);
      this.tasks = await this.adapter.loadTasks(this._dataSource, helpers);

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
    }

    return this.info!;
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

  private async readParquetByPath(path: string, columns?: string[]): Promise<Uint8Array> {
    const bytes = await this.readFileBytesCached(path);
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return await this.worker.readParquet(buffer, columns);
  }

  private async readFileBytesCached(path: string): Promise<Uint8Array> {
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
   * 一次性加载所有数值列 - 优化版本
   */
  async loadAllNumericalData(episodeIndex: number, columns: string[]): Promise<NumericalColumnMap> {
    if (!this.info) throw new Error('Not initialized');
    if (columns.length === 0) return {};

    const { path, start, end } = this.getEpisodeRange(episodeIndex);
    const bytes = await this.readFileBytesCached(path);
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const result = await this.worker.readNumericColumns(buffer, columns, start, end);

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

  private getEpisodeRange(episodeIndex: number): { path: string; start: number; end: number } {
    if (!this.info || !this.adapter) throw new Error('Not initialized');

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
    const bytes = await this.readFileBytesCached(path);
    const buffer = (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return this.worker.readFeatureData(buffer, featureNames, start, end);
  }

  getEpisodes() {
    return this.episodes;
  }

  getTasks() {
    return this.tasks;
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
    return this.adapter.getEpisodeDataPath(this.info, this.episodes, episodeIndex);
  }

  /**
   * Version-agnostic: path and optional time range for this episode's video feature.
   * Used by VideoPanel and export. Returns null if not found.
   */
  getEpisodeVideoPath(episodeIndex: number, featureKey: string): EpisodeVideoPathResult | null {
    if (!this.info || !this.adapter) return null;
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
    this.pendingParses.clear();
    try {
      await this.worker.clearCache();
    } catch {
      // ignore
    }
  }

  /** 仅当需要强制重新解析指定路径时使用 */
  isFileBytesCached(path: string): boolean {
    return this.fileBytesCache?.path === path;
  }
}
