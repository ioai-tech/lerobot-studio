import { ZipReader, BlobReader, HttpReader, TextWriter, Uint8ArrayWriter } from '@zip.js/zip.js';
import { gunzipSync } from 'fflate';

/**
 * 简易 LRU cache for blob URLs.
 * 被淘汰项会自动 URL.revokeObjectURL，防止内存泄漏。
 * （旧实现使用 Map 无上限增长，大型数据集下 video blob URL 会累积 GB 级内存）。
 */
const OBJECT_URL_CACHE_SIZE = 64;

class BlobUrlLruCache {
  private map = new Map<string, string>();
  private max: number;
  constructor(max: number = OBJECT_URL_CACHE_SIZE) {
    this.max = max;
  }

  /** 按逻辑路径失效：cache key 形如 `${mime}:${normalizedPath}`，mime 可能含 `/`（如 video/mp4） */
  invalidatePath(normalizedPath: string): void {
    const needle = `:${normalizedPath}`;
    const keysToRemove: string[] = [];
    this.map.forEach((_url, key) => {
      if (key.endsWith(needle)) {
        keysToRemove.push(key);
      }
    });
    for (const key of keysToRemove) {
      const old = this.map.get(key);
      if (old !== undefined) {
        this.map.delete(key);
        if (old.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(old);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (!v) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, url: string): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        const old = this.map.get(oldestKey);
        this.map.delete(oldestKey);
        if (old && old.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(old);
          } catch {
            /* ignore */
          }
        }
      }
    }
    this.map.set(key, url);
  }

  forEach(fn: (url: string, key: string) => void): void {
    this.map.forEach((url, key) => fn(url, key));
  }

  clear(): void {
    this.map.forEach((url) => {
      if (url.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
    });
    this.map.clear();
  }
}

import type {
  DataSource,
  ProgressHandler,
  ProgressInfo,
  LoadingPhase,
} from '@ioai/lerobot-studio-core';
export type { DataSource, ProgressHandler, ProgressInfo, LoadingPhase };

function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\/+/, '');
  normalized = normalized.replace(/\/{2,}/g, '/');
  normalized = normalized.replace(/^\/+/, '');
  return normalized;
}

function getDatasetRootPrefix(paths: string[]): string {
  for (const raw of paths) {
    const p = normalizePath(raw);
    if (p === 'meta/info.json') return '';
    if (p.endsWith('/meta/info.json')) {
      return p.slice(0, p.length - 'meta/info.json'.length);
    }
  }
  throw new Error('Not a valid LeRobot dataset: meta/info.json not found in archive');
}

abstract class BaseZipDataSource implements DataSource {
  protected zipReader: ZipReader<any>;
  protected entryMap: Map<string, any> = new Map();
  protected datasetRootPrefix = '';
  protected objectUrlCache: BlobUrlLruCache = new BlobUrlLruCache();
  protected objectUrlLoading: Map<string, Promise<string>> = new Map();
  protected initPromise: Promise<void> | null = null;

  constructor(zipReader: ZipReader<any>) {
    this.zipReader = zipReader;
  }

  protected resolvePath(path: string): string {
    const normalized = normalizePath(path);
    return `${this.datasetRootPrefix}${normalized}`;
  }

  protected async ensureInitialized() {
    if (this.entryMap.size > 0) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const entries = await this.zipReader.getEntries();
      const paths = entries.map((e: any) => normalizePath(e.filename || e.name));
      this.datasetRootPrefix = getDatasetRootPrefix(paths);
      entries.forEach((entry: any) => {
        const key = normalizePath(entry.filename || entry.name);
        this.entryMap.set(key, entry);
      });
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.entryMap.has(this.resolvePath(path));
  }

  async listPaths(): Promise<string[]> {
    await this.ensureInitialized();
    return [...this.entryMap.keys()]
      .filter((path) => path.startsWith(this.datasetRootPrefix))
      .map((path) => path.slice(this.datasetRootPrefix.length))
      .filter(Boolean);
  }

  async readText(path: string, _onProgress?: ProgressHandler): Promise<string> {
    await this.ensureInitialized();
    const entry = this.entryMap.get(this.resolvePath(path));
    if (!entry) throw new Error(`File not found in archive: ${path}`);
    const writer = new TextWriter();
    return entry.getData(writer);
  }

  async readBytes(path: string, _onProgress?: ProgressHandler): Promise<Uint8Array> {
    await this.ensureInitialized();
    const entry = this.entryMap.get(this.resolvePath(path));
    if (!entry) throw new Error(`File not found in archive: ${path}`);
    const writer = new Uint8ArrayWriter();
    return entry.getData(writer);
  }

  async getObjectUrl(
    path: string,
    mimeType?: string,
    onProgress?: ProgressHandler,
  ): Promise<string> {
    const cacheKey = `${mimeType || 'application/octet-stream'}:${path}`;
    const cached = this.objectUrlCache.get(cacheKey);
    if (cached) return cached;
    const loading = this.objectUrlLoading.get(cacheKey);
    if (loading) return loading;

    const promise = (async () => {
      const bytes = await this.readBytes(path, onProgress);
      // 复制到新的 ArrayBuffer，避免 SharedArrayBuffer 导致的类型不兼容
      const safeBytes = new Uint8Array(bytes.byteLength);
      safeBytes.set(bytes);
      const blob = new Blob([safeBytes.buffer], { type: mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      this.objectUrlCache.set(cacheKey, url);
      return url;
    })();
    this.objectUrlLoading.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.objectUrlLoading.delete(cacheKey);
    }
  }

  async invalidateObjectUrl(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const needle = `:${normalized}`;
    for (const key of [...this.objectUrlLoading.keys()]) {
      if (key.endsWith(needle)) {
        this.objectUrlLoading.delete(key);
      }
    }
    this.objectUrlCache.invalidatePath(normalized);
  }

  async clear() {
    this.objectUrlCache.clear();
    this.objectUrlLoading.clear();
    this.initPromise = null;
    await this.zipReader.close();
  }
}

export class ZipDataSourceLocal extends BaseZipDataSource {
  constructor(file: File) {
    const reader = new BlobReader(file);
    const zipReader = new ZipReader(reader, { useWebWorkers: false });
    super(zipReader);
  }
}

export class ZipDataSourceHttp extends BaseZipDataSource {
  constructor(url: string) {
    const reader = new HttpReader(url, {
      preventHeadRequest: true,
      useRangeHeader: true,
      forceRangeRequests: true,
    });
    const zipReader = new ZipReader(reader, { useWebWorkers: false });
    super(zipReader);
  }
}

export const MAX_IN_MEMORY_FULL_ARCHIVE_BYTES = 32 * 1024 * 1024;

type OpfsStorage = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

type DownloadedArchive = {
  file: File;
  cleanup: () => Promise<void>;
};

function makeArchiveFileName(): string {
  return `lerobot-studio-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}.archive`;
}

async function collectSmallResponse(
  response: Response,
  maxBytes: number,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<File> {
  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The server did not provide a readable response body');
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > maxBytes) {
        throw new Error(
          `This browser cannot store a ${loaded} byte archive safely. Enable Range requests or use a browser with OPFS support.`,
        );
      }
      chunks.push(value);
      onProgress?.({ phase: 'download', loaded, total, message: 'Downloading archive...' });
    }
  } finally {
    reader.releaseLock();
  }
  const parts = chunks.map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  });
  return new File(parts, 'remote-archive');
}

async function downloadResponseToOpfs(
  response: Response,
  maxBytes: number,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<DownloadedArchive> {
  const storage = navigator.storage as OpfsStorage;
  const directory = await storage.getDirectory?.();
  if (!directory) {
    return {
      file: await collectSmallResponse(
        response,
        MAX_IN_MEMORY_FULL_ARCHIVE_BYTES,
        onProgress,
        signal,
      ),
      cleanup: async () => undefined,
    };
  }

  const expected = Number(response.headers.get('content-length') || 0);
  const estimate = await navigator.storage.estimate?.();
  if (
    expected > 0 &&
    estimate?.quota !== undefined &&
    (estimate.usage ?? 0) + expected > estimate.quota * 0.9
  ) {
    throw new Error('Insufficient browser storage for this complete archive download');
  }

  const name = makeArchiveFileName();
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  const reader = response.body?.getReader();
  if (!reader) {
    await writable.abort();
    await directory.removeEntry(name).catch(() => undefined);
    throw new Error('The server did not provide a readable response body');
  }
  const total = expected;
  let loaded = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > maxBytes) {
        throw new Error(`Complete archive download exceeds the ${maxBytes} byte safety limit`);
      }
      await writable.write(value);
      onProgress?.({
        phase: 'download',
        loaded,
        total,
        message: 'Downloading complete archive...',
      });
    }
    await writable.close();
    return {
      file: await fileHandle.getFile(),
      cleanup: () => directory.removeEntry(name).catch(() => undefined),
    };
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await directory.removeEntry(name).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Uses OPFS as the backing store when a remote server ignores Range. The
 * archive bytes never need to be accumulated in the JavaScript heap.
 */
export class RemoteFullArchiveDataSource implements DataSource {
  private source: DataSource | null = null;
  private ready: Promise<DataSource> | null = null;
  private cleanup: (() => Promise<void>) | null = null;
  private controller = new AbortController();
  private readonly url: string;
  private readonly kind: 'zip' | 'tar' | 'targz';
  private readonly onProgress?: ProgressHandler;
  private readonly maxBytes: number;

  constructor(
    url: string,
    kind: 'zip' | 'tar' | 'targz',
    onProgress?: ProgressHandler,
    maxBytes = 2 * 1024 * 1024 * 1024,
  ) {
    this.url = url;
    this.kind = kind;
    this.onProgress = onProgress;
    this.maxBytes = maxBytes;
  }

  private async getSource(): Promise<DataSource> {
    if (this.source) return this.source;
    if (!this.ready) {
      this.ready = (async () => {
        try {
          const response = await fetch(this.url, { signal: this.controller.signal });
          if (!response.ok) throw new Error(`Failed to fetch ${this.url}: ${response.status}`);
          const downloaded = await downloadResponseToOpfs(
            response,
            this.maxBytes,
            this.onProgress,
            this.controller.signal,
          );
          this.cleanup = downloaded.cleanup;
          if (this.kind === 'zip') return new ZipDataSourceLocal(downloaded.file);
          if (this.kind === 'tar') return new TarDataSourceLocal(downloaded.file);
          if (downloaded.file.size > MAX_IN_MEMORY_FULL_ARCHIVE_BYTES) {
            throw new Error(
              'A .tar.gz archive without Range support must be 32MB or smaller to avoid unsafe decompression memory use.',
            );
          }
          return new TarGzDataSourceLocal(downloaded.file, this.onProgress);
        } catch (error) {
          await this.cleanup?.();
          this.cleanup = null;
          throw error;
        }
      })().then((source) => {
        this.source = source;
        return source;
      });
    }
    return this.ready;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.getSource()).exists(path);
  }

  async listPaths(): Promise<string[]> {
    const source = await this.getSource();
    return source.listPaths ? source.listPaths() : [];
  }

  async readText(path: string, onProgress?: ProgressHandler): Promise<string> {
    return (await this.getSource()).readText(path, onProgress);
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    return (await this.getSource()).readBytes(path, onProgress);
  }

  async getObjectUrl(
    path: string,
    mimeType?: string,
    onProgress?: ProgressHandler,
  ): Promise<string> {
    return (await this.getSource()).getObjectUrl(path, mimeType, onProgress);
  }

  async invalidateObjectUrl(path: string): Promise<void> {
    const source = await this.getSource();
    await source.invalidateObjectUrl?.(path);
  }

  async clear(): Promise<void> {
    this.controller.abort();
    const source = this.source;
    this.source = null;
    this.ready = null;
    await source?.clear();
    await this.cleanup?.();
    this.cleanup = null;
  }
}

export class DirectoryDataSource implements DataSource {
  private rootHandle: FileSystemDirectoryHandle;
  private objectUrlCache: BlobUrlLruCache = new BlobUrlLruCache();
  private objectUrlLoading: Map<string, Promise<string>> = new Map();

  constructor(rootHandle: FileSystemDirectoryHandle) {
    this.rootHandle = rootHandle;
  }

  private async getFileHandle(path: string): Promise<FileSystemFileHandle> {
    const parts = normalizePath(path).split('/');
    let current: FileSystemDirectoryHandle | FileSystemFileHandle = this.rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(parts[i]);
    }
    return (current as FileSystemDirectoryHandle).getFileHandle(parts[parts.length - 1]);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.getFileHandle(path);
      return true;
    } catch {
      return false;
    }
  }

  async listPaths(): Promise<string[]> {
    const paths: string[] = [];
    const visit = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of directory.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === 'file') {
          paths.push(path);
        } else {
          await visit(handle, path);
        }
      }
    };
    await visit(this.rootHandle, '');
    return paths;
  }

  async readText(path: string, _onProgress?: ProgressHandler): Promise<string> {
    const fileHandle = await this.getFileHandle(path);
    const file = await fileHandle.getFile();
    return file.text();
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    const fileHandle = await this.getFileHandle(path);
    const file = await fileHandle.getFile();
    onProgress?.({ phase: 'read', loaded: 0, total: file.size });
    return new Uint8Array(await file.arrayBuffer());
  }

  async getObjectUrl(
    path: string,
    mimeType?: string,
    onProgress?: ProgressHandler,
  ): Promise<string> {
    const normalized = normalizePath(path);
    const cacheKey = `${mimeType || 'application/octet-stream'}:${normalized}`;
    const cached = this.objectUrlCache.get(cacheKey);
    if (cached) return cached;
    const loading = this.objectUrlLoading.get(cacheKey);
    if (loading) return loading;

    const promise = (async () => {
      const fileHandle = await this.getFileHandle(path);
      const file = await fileHandle.getFile();
      onProgress?.({ phase: 'read', loaded: 0, total: file.size });
      const blob = mimeType ? file.slice(0, file.size, mimeType) : file;
      const url = URL.createObjectURL(blob);
      this.objectUrlCache.set(cacheKey, url);
      return url;
    })();
    this.objectUrlLoading.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.objectUrlLoading.delete(cacheKey);
    }
  }

  async invalidateObjectUrl(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const needle = `:${normalized}`;
    for (const key of [...this.objectUrlLoading.keys()]) {
      if (key.endsWith(needle)) {
        this.objectUrlLoading.delete(key);
      }
    }
    this.objectUrlCache.invalidatePath(normalized);
  }

  clear() {
    this.objectUrlCache.clear();
    this.objectUrlLoading.clear();
  }
}

export class FileListDirectoryDataSource implements DataSource {
  private fileMap: Map<string, File> = new Map();
  private objectUrlCache: BlobUrlLruCache = new BlobUrlLruCache();
  private datasetRootPrefix = '';

  constructor(files: FileList | File[]) {
    const selected = Array.from(files);
    const paths: string[] = [];
    for (const file of selected) {
      const relativePath = normalizePath(file.webkitRelativePath || file.name);
      if (!relativePath) continue;
      this.fileMap.set(relativePath, file);
      paths.push(relativePath);
    }
    if (paths.length === 0) {
      throw new Error('No files selected from directory');
    }
    this.datasetRootPrefix = getDatasetRootPrefix(paths);
  }

  private resolvePath(path: string): string {
    return `${this.datasetRootPrefix}${normalizePath(path)}`;
  }

  private getFile(path: string): File {
    const file = this.fileMap.get(this.resolvePath(path));
    if (!file) throw new Error(`File not found in selected directory: ${path}`);
    return file;
  }

  async exists(path: string): Promise<boolean> {
    return this.fileMap.has(this.resolvePath(path));
  }

  async listPaths(): Promise<string[]> {
    return [...this.fileMap.keys()]
      .filter((path) => path.startsWith(this.datasetRootPrefix))
      .map((path) => path.slice(this.datasetRootPrefix.length))
      .filter(Boolean);
  }

  async readText(path: string, _onProgress?: ProgressHandler): Promise<string> {
    return this.getFile(path).text();
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    const file = this.getFile(path);
    onProgress?.({ phase: 'read', loaded: 0, total: file.size });
    return new Uint8Array(await file.arrayBuffer());
  }

  async getObjectUrl(
    path: string,
    mimeType?: string,
    onProgress?: ProgressHandler,
  ): Promise<string> {
    const cacheKey = `${mimeType || 'application/octet-stream'}:${path}`;
    const cached = this.objectUrlCache.get(cacheKey);
    if (cached) return cached;
    const file = this.getFile(path);
    onProgress?.({ phase: 'read', loaded: 0, total: file.size });
    const blob = mimeType ? file.slice(0, file.size, mimeType) : file;
    const url = URL.createObjectURL(blob);
    this.objectUrlCache.set(cacheKey, url);
    return url;
  }

  async invalidateObjectUrl(path: string): Promise<void> {
    const normalized = normalizePath(path);
    this.objectUrlCache.invalidatePath(normalized);
    const resolved = this.resolvePath(path);
    if (resolved !== normalized) {
      this.objectUrlCache.invalidatePath(resolved);
    }
  }

  clear() {
    this.objectUrlCache.clear();
  }
}

// -------- TAR helpers --------
interface TarEntryMeta {
  path: string;
  offset: number; // data offset
  size: number;
  type: 'file' | 'dir';
}

function parseOctal(str: string): number {
  const trimmed = str.replace(/\0.*$/, '').trim();
  if (!trimmed) return 0;
  return parseInt(trimmed, 8);
}

function parseTarHeader(block: Uint8Array, globalOffset: number): TarEntryMeta | null {
  // 检查是否为空块
  if (block.every((b) => b === 0)) return null;

  const decoder = new TextDecoder();

  // 读取基本名称 (0-100)
  let name = decoder.decode(block.slice(0, 100)).replace(/\0.*$/, '');
  if (!name) return null;

  // USTAR 格式：检查 prefix 字段 (345-500)
  // magic 字段在 257-263，如果是 "ustar" 则支持 prefix
  const magic = decoder.decode(block.slice(257, 263)).replace(/\0.*$/, '');
  if (magic === 'ustar' || magic === 'ustar ') {
    const prefix = decoder.decode(block.slice(345, 500)).replace(/\0.*$/, '');
    if (prefix) {
      name = prefix + '/' + name;
    }
  }

  const sizeStr = decoder.decode(block.slice(124, 136));
  const size = parseOctal(sizeStr);
  const typeflag = block[156];

  // 处理不同的类型标志
  // '0' 或 '\0' - 普通文件
  // '5' - 目录
  // 'L' - GNU 长文件名（需要特殊处理，但这里暂时跳过）
  // 'g', 'x' - PAX 扩展头（跳过）
  const type: 'file' | 'dir' = typeflag === 53 /* '5' */ ? 'dir' : 'file';

  return { path: normalizePath(name), offset: globalOffset + 512, size, type };
}

function pad512(n: number) {
  return Math.ceil(n / 512) * 512;
}

function toSafeBuffer(bytes: Uint8Array): ArrayBuffer {
  const safe = new Uint8Array(bytes.length);
  safe.set(bytes);
  return safe.buffer;
}

function concatUint8(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function gunzipNative(data: ArrayBuffer): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const stream = new Response(new Blob([data]).stream().pipeThrough(ds));
    const buf = await stream.arrayBuffer();
    return new Uint8Array(buf);
  }
  return gunzipSync(new Uint8Array(data));
}

abstract class BaseTarDataSource implements DataSource {
  protected entries: Map<string, TarEntryMeta> = new Map();
  protected objectUrlCache: BlobUrlLruCache = new BlobUrlLruCache();
  protected objectUrlLoading: Map<string, Promise<string>> = new Map();
  protected indexed = false;
  protected datasetRootPrefix = '';

  protected resolvePath(path: string): string {
    return `${this.datasetRootPrefix}${normalizePath(path)}`;
  }

  protected finalizeDatasetRootPrefix() {
    // tar/tar.gz 可能把数据集放在一个上级目录里：自动识别根前缀
    const paths = Array.from(this.entries.keys());
    this.datasetRootPrefix = getDatasetRootPrefix(paths);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureIndex();
    return this.entries.has(this.resolvePath(path));
  }

  // subclasses must implement ensureIndex/readEntry/raw access
  protected abstract ensureIndex(onProgress?: ProgressHandler): Promise<void>;
  protected abstract readEntry(path: string, onProgress?: ProgressHandler): Promise<Uint8Array>;

  async readText(path: string, onProgress?: ProgressHandler): Promise<string> {
    const bytes = await this.readEntry(path, onProgress);
    return new TextDecoder().decode(bytes);
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    return this.readEntry(path, onProgress);
  }

  async getObjectUrl(
    path: string,
    mimeType?: string,
    onProgress?: ProgressHandler,
  ): Promise<string> {
    const resolved = this.resolvePath(path);
    const cacheKey = `${mimeType || 'application/octet-stream'}:${resolved}`;
    const cached = this.objectUrlCache.get(cacheKey);
    if (cached) return cached;
    const loading = this.objectUrlLoading.get(cacheKey);
    if (loading) return loading;

    const promise = (async () => {
      const bytes = await this.readEntry(path, onProgress);
      const blob = new Blob([toSafeBuffer(bytes)], {
        type: mimeType || 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);
      this.objectUrlCache.set(cacheKey, url);
      return url;
    })();
    this.objectUrlLoading.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.objectUrlLoading.delete(cacheKey);
    }
  }

  async invalidateObjectUrl(path: string): Promise<void> {
    const resolved = this.resolvePath(path);
    const needle = `:${resolved}`;
    for (const key of [...this.objectUrlLoading.keys()]) {
      if (key.endsWith(needle)) {
        this.objectUrlLoading.delete(key);
      }
    }
    this.objectUrlCache.invalidatePath(resolved);
  }

  clear() {
    this.objectUrlCache.clear();
    this.objectUrlLoading.clear();
    this.entries.clear();
    this.datasetRootPrefix = '';
    this.indexed = false;
  }
}

export class TarDataSourceLocal implements DataSource {
  private base: BaseTarDataSource;

  constructor(file: File) {
    // delegate to shared base impl (composition avoids touching public type surface)
    this.base = new (class extends BaseTarDataSource {
      private outer = file;
      private indexPromise: Promise<void> | null = null;

      private emit(onProgress: ProgressHandler | undefined, info: ProgressInfo) {
        onProgress?.(info);
      }

      private async readChunk(start: number, length: number): Promise<Uint8Array> {
        const slice = this.outer.slice(start, start + length);
        const buf = new Uint8Array(await slice.arrayBuffer());
        const safe = new Uint8Array(buf.length);
        safe.set(buf);
        return safe;
      }

      protected async ensureIndex(onProgress?: ProgressHandler) {
        if (this.indexed) return;
        if (this.indexPromise) {
          await this.indexPromise;
          return;
        }

        this.indexPromise = (async () => {
          const total = this.outer.size;
          // `pos` 表示已经从文件头读取到的“末端”绝对偏移（end offset）
          // buffer 保存的是 [pos - buffer.length, pos) 这一段数据
          let pos = 0;
          let buffer: Uint8Array = new Uint8Array(0);
          const chunkSize = 4 * 1024 * 1024;

          while (pos < total) {
            const remain = total - pos;
            const chunk = await this.readChunk(pos, Math.min(chunkSize, remain));
            buffer = concatUint8(buffer, chunk) as Uint8Array;
            // 读入 chunk 后，pos 前进到新的 end offset
            pos += chunk.length;
            let cursor = 0;
            while (buffer.length - cursor >= 512) {
              const headerView = buffer.subarray(cursor, cursor + 512);
              if (headerView.every((b) => b === 0)) {
                pos = total; // reached end-of-archive
                cursor = buffer.length;
                break;
              }
              // 注意：buffer 可能包含上一次循环的残留数据，因此 header 的全局偏移
              // 不能用 `pos + cursor`，而应该用 `(pos - buffer.length) + cursor`
              const entry = parseTarHeader(headerView, pos - buffer.length + cursor);
              if (!entry) {
                pos = total;
                cursor = buffer.length;
                break;
              }
              this.entries.set(entry.path, entry);
              const dataSize = pad512(entry.size);
              const need = 512 + dataSize;
              if (buffer.length - cursor < need) {
                break; // need more data
              }
              cursor += need;
            }
            buffer = buffer.slice(cursor);
            this.emit(onProgress, { phase: 'index', loaded: pos, total, message: 'Indexing tar' });
          }
          this.finalizeDatasetRootPrefix();
          this.indexed = true;
        })();

        try {
          await this.indexPromise;
        } finally {
          this.indexPromise = null;
        }
      }

      protected async readEntry(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
        await this.ensureIndex(onProgress);
        const entry = this.entries.get(this.resolvePath(path));
        if (!entry) throw new Error(`File not found in tar: ${path}`);
        const slice = this.outer.slice(entry.offset, entry.offset + entry.size);
        onProgress?.({ phase: 'read', loaded: 0, total: entry.size });
        return new Uint8Array(await slice.arrayBuffer());
      }
    })();
  }

  async exists(path: string): Promise<boolean> {
    return this.base.exists(path);
  }

  async readText(path: string, onProgress?: ProgressHandler): Promise<string> {
    return this.base.readText(path, onProgress);
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    return this.base.readBytes(path, onProgress);
  }

  async getObjectUrl(
    path: string,
    mimeType?: string,
    onProgress?: ProgressHandler,
  ): Promise<string> {
    return this.base.getObjectUrl(path, mimeType, onProgress);
  }

  async invalidateObjectUrl(path: string): Promise<void> {
    return this.base.invalidateObjectUrl(path);
  }

  clear() {
    this.base.clear();
  }
}

class TarBufferDataSource implements DataSource {
  private buffer: Uint8Array = new Uint8Array(0);
  private bufferReady: Promise<void>;
  private base: BaseTarDataSource;

  constructor(buffer: Uint8Array | Promise<Uint8Array>) {
    if (buffer instanceof Promise) {
      this.bufferReady = buffer.then((buf) => {
        this.buffer = buf;
      });
    } else {
      this.buffer = buffer;
      this.bufferReady = Promise.resolve();
    }

    this.base = new (class extends BaseTarDataSource {
      private outer: TarBufferDataSource;
      private indexPromise: Promise<void> | null = null;

      constructor(outer: TarBufferDataSource) {
        super();
        this.outer = outer;
      }

      protected async ensureIndex(onProgress?: ProgressHandler) {
        if (this.indexed) return;
        if (this.indexPromise) {
          await this.indexPromise;
          return;
        }

        this.indexPromise = (async () => {
          await this.outer.bufferReady;
          let cursor = 0;
          const total = this.outer.buffer.length;
          while (cursor + 512 <= total) {
            const block = this.outer.buffer.subarray(cursor, cursor + 512);
            if (block.every((b) => b === 0)) break;
            const entry = parseTarHeader(block, cursor);
            if (!entry) break;
            this.entries.set(entry.path, entry);
            const step = 512 + pad512(entry.size);
            cursor += step;
            onProgress?.({ phase: 'index', loaded: cursor, total });
          }
          this.finalizeDatasetRootPrefix();
          this.indexed = true;
        })();

        try {
          await this.indexPromise;
        } finally {
          this.indexPromise = null;
        }
      }

      protected async readEntry(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
        await this.ensureIndex(onProgress);
        const entry = this.entries.get(this.resolvePath(path));
        if (!entry) throw new Error(`File not found in tar: ${path}`);
        const data = this.outer.buffer.subarray(entry.offset, entry.offset + entry.size);
        onProgress?.({ phase: 'read', loaded: entry.size, total: entry.size });
        const copy = new Uint8Array(data.length);
        copy.set(data);
        return copy;
      }
    })(this);
  }

  async exists(path: string): Promise<boolean> {
    return this.base.exists(path);
  }

  async readText(path: string, onProgress?: ProgressHandler): Promise<string> {
    return this.base.readText(path, onProgress);
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    return this.base.readBytes(path, onProgress);
  }

  async getObjectUrl(
    path: string,
    mimeType?: string,
    onProgress?: ProgressHandler,
  ): Promise<string> {
    return this.base.getObjectUrl(path, mimeType, onProgress);
  }

  async invalidateObjectUrl(path: string): Promise<void> {
    return this.base.invalidateObjectUrl(path);
  }

  clear() {
    this.base.clear();
  }
}

export class TarGzDataSourceLocal extends TarBufferDataSource {
  constructor(file: File, onProgress?: ProgressHandler) {
    const bufferPromise = (async () => {
      onProgress?.({ phase: 'download', loaded: 0, total: file.size, message: 'Reading tar.gz' });
      const data = new Uint8Array(await file.arrayBuffer());
      onProgress?.({ phase: 'gunzip', loaded: 0, total: data.length, message: 'Decompressing' });
      const unzipped = await gunzipNative(data.buffer);
      return unzipped;
    })();
    super(bufferPromise);
  }
}

export class TarGzDataSourceHttp extends TarBufferDataSource {
  constructor(url: string, onProgress?: ProgressHandler) {
    const bufferPromise = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);
      const arrayBuf = await res.arrayBuffer();
      onProgress?.({
        phase: 'download',
        loaded: total || arrayBuf.byteLength,
        total,
        message: 'Downloaded tar.gz',
      });
      onProgress?.({
        phase: 'gunzip',
        loaded: 0,
        total: arrayBuf.byteLength,
        message: 'Decompressing',
      });
      const unzipped = await gunzipNative(arrayBuf);
      return unzipped;
    })();
    super(bufferPromise);
  }
}

/**
 * 远程 tar 文件数据源
 *
 * 策略：直接下载整个 tar 文件到内存，然后解析索引。
 * 这比复杂的分片加载更简单可靠。
 *
 * 对于大文件，建议服务端使用 zip 格式（有中央目录索引，支持按需加载）。
 * tar 格式适合小型数据集（< 100MB）。
 */
export class TarDataSourceHttp extends TarBufferDataSource {
  constructor(url: string, onProgress?: ProgressHandler) {
    const bufferPromise = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);

      // 使用流式读取以便报告进度
      if (res.body && total > 0) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          onProgress?.({ phase: 'download', loaded, total, message: 'Downloading tar...' });
        }

        // 合并所有 chunks
        const result = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result;
      } else {
        // 降级：一次性读取
        const arrayBuf = await res.arrayBuffer();
        onProgress?.({
          phase: 'download',
          loaded: arrayBuf.byteLength,
          total: arrayBuf.byteLength,
          message: 'Downloaded tar',
        });
        return new Uint8Array(arrayBuf);
      }
    })();
    super(bufferPromise);
  }
}
