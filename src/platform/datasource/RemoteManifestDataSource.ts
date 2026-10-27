import type { DataSource, ProgressHandler, RangeReadOptions } from '../../core/datasource/types';
import {
  assertMaterializable,
  DataSourceSafetyError,
  type DataSourceSafetyLimits,
  resolveSafetyLimits,
  validateUntrustedPath,
} from './inputSafety';

/** One host-signed file in a remote dataset manifest. */
export interface RemoteFileEntry {
  /** Logical path inside the LeRobot dataset, such as `meta/info.json`. */
  logicalPath: string;
  /** HTTP(S) URL the browser can fetch or stream. */
  presignedUrl: string;
  /** Optional MIME type for the file. */
  contentType?: string | null;
  /** Optional size in bytes; used by safety limits when present. */
  sizeBytes?: number | null;
  /** Optional expiry of `presignedUrl` (ISO 8601); with `refresh`, URLs are renewed before it. */
  expiresAt?: string | null;
}

/** Options for a manifest whose presigned URLs expire. */
export interface RemoteManifestOptions {
  /**
   * Returns a fresh manifest (same paths, new URLs). Called shortly before the earliest `expiresAt`
   * and after a request is refused with 400/401/403, which is how object stores answer an expired
   * signature. The data source keeps its identity, so the viewer does not reload.
   */
  refresh?: () => Promise<RemoteFileEntry[]>;
}

/**
 * Presigned URL renewal timing (ms). `marginMs`: renew this long before the earliest expiry, so a
 * Range request never carries a dead URL. `minProactiveMs`: proactive renewals (before the expiry)
 * run at most this often, so a host that signs URLs for two minutes or less, or whose refresh
 * returns the URLs it already had, is not asked once per request (a refused request always
 * renews). Internal; tests shorten it to play URL lifetimes in seconds.
 */
export const MANIFEST_REFRESH_POLICY = { marginMs: 2 * 60_000, minProactiveMs: 30_000 };
/** A size lookup that failed is not repeated for this long (ms). */
const SIZE_FAILURE_TTL_MS = 60_000;

function isExpiredSignature(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\/+/, '');
  normalized = normalized.replace(/\/{2,}/g, '/');
  normalized = normalized.replace(/^\/+/, '');
  return normalized;
}

/**
 * A DataSource backed by a manifest of presigned URLs.
 *
 * Files are fetched on demand via HTTP fetch using the presigned URLs.
 * Video files served via getObjectUrl() are streamed directly by the browser
 * without downloading the entire file first, enabling playback of large
 * remote datasets without loading all data upfront.
 */
export class RemoteManifestDataSource implements DataSource {
  private readonly entryMap = new Map<string, RemoteFileEntry>();
  private readonly limits: Readonly<DataSourceSafetyLimits>;
  private readonly sizeLookups = new Map<string, Promise<number>>();
  private readonly refreshManifest?: () => Promise<RemoteFileEntry[]>;
  private refreshing: Promise<void> | null = null;
  private readonly staleUrls = new Set<string>();
  private earliestExpiry = Number.POSITIVE_INFINITY;
  private lastProactiveRefresh = Number.NEGATIVE_INFINITY;
  private readonly sizeFailures = new Map<string, { at: number; error: Error }>();

  constructor(
    files: RemoteFileEntry[],
    limitOverrides?: Partial<DataSourceSafetyLimits>,
    options: RemoteManifestOptions = {},
  ) {
    this.refreshManifest = options.refresh;
    this.limits = resolveSafetyLimits(limitOverrides);
    if (files.length > this.limits.maxManifestEntries) {
      throw new DataSourceSafetyError('ENTRY_COUNT_LIMIT', 'Manifest contains too many entries', {
        count: files.length,
        limit: this.limits.maxManifestEntries,
      });
    }

    let totalBytes = 0;
    for (const file of files) {
      const path = validateUntrustedPath(file.logicalPath, this.limits);
      if (this.entryMap.has(path)) {
        throw new DataSourceSafetyError('DUPLICATE_PATH', 'Manifest contains a duplicate path', {
          path,
        });
      }
      validateManifestUrl(file.presignedUrl, this.limits, path);
      if (file.sizeBytes != null && (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0)) {
        throw new DataSourceSafetyError('MANIFEST_INVALID', 'Manifest entry has an invalid size', {
          path,
          size: file.sizeBytes,
        });
      }
      if (file.sizeBytes != null) {
        if (file.sizeBytes > this.limits.maxManifestEntryBytes) {
          throw new DataSourceSafetyError(
            'ENTRY_SIZE_LIMIT',
            'Manifest entry exceeds the size limit',
            { path, size: file.sizeBytes, limit: this.limits.maxManifestEntryBytes },
          );
        }
        totalBytes += file.sizeBytes;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > this.limits.maxManifestTotalBytes) {
          throw new DataSourceSafetyError(
            'TOTAL_SIZE_LIMIT',
            'Manifest exceeds the total size limit',
            { total: totalBytes, limit: this.limits.maxManifestTotalBytes },
          );
        }
      }
      this.entryMap.set(path, file);
      this.noteExpiry(file);
    }
  }

  private noteExpiry(file: RemoteFileEntry): void {
    const expiry = file.expiresAt ? Date.parse(file.expiresAt) : Number.NaN;
    if (Number.isFinite(expiry)) this.earliestExpiry = Math.min(this.earliestExpiry, expiry);
  }

  /**
   * Swap in fresh URLs for the paths this manifest already has; new paths are ignored, and paths
   * the refresh left out keep their URLs (and still count towards the next renewal).
   */
  private applyRefresh(files: RemoteFileEntry[]): void {
    for (const file of files) {
      const path = validateUntrustedPath(file.logicalPath, this.limits);
      const current = this.entryMap.get(path);
      if (!current) continue;
      validateManifestUrl(file.presignedUrl, this.limits, path);
      this.entryMap.set(path, {
        ...current,
        presignedUrl: file.presignedUrl,
        expiresAt: file.expiresAt,
      });
    }
    this.earliestExpiry = Number.POSITIVE_INFINITY;
    for (const entry of this.entryMap.values()) this.noteExpiry(entry);
  }

  /**
   * Renew the URLs once for all concurrent callers; `force` after a refused request. A proactive
   * renewal runs at most every `MANIFEST_REFRESH_POLICY.minProactiveMs`, and when it fails the current URLs stay
   * in use until the store refuses one.
   */
  private async renew(force: boolean): Promise<boolean> {
    if (!this.refreshManifest) return false;
    if (!force) {
      if (this.earliestExpiry - Date.now() > MANIFEST_REFRESH_POLICY.marginMs) return false;
      if (Date.now() - this.lastProactiveRefresh < MANIFEST_REFRESH_POLICY.minProactiveMs)
        return false;
      this.lastProactiveRefresh = Date.now();
    }
    if (!this.refreshing) {
      this.refreshing = this.refreshManifest()
        .then((files) => this.applyRefresh(files))
        .finally(() => {
          this.refreshing = null;
        });
    }
    if (force) {
      await this.refreshing;
      return true;
    }
    try {
      await this.refreshing;
      return true;
    } catch (error) {
      console.warn('[lerobot] could not renew the manifest URLs ahead of their expiry', error);
      return false;
    }
  }

  /** fetch with a fresh URL, renewing and retrying once when the store refuses the signature. */
  private async fetchEntry(path: string, init?: RequestInit): Promise<Response> {
    await this.renew(false);
    const res = await fetch(this.getEntry(path).presignedUrl, init);
    if (isExpiredSignature(res.status) && (await this.renew(true))) {
      await res.body?.cancel();
      return fetch(this.getEntry(path).presignedUrl, init);
    }
    return res;
  }

  async exists(path: string): Promise<boolean> {
    return this.entryMap.has(normalizePath(path));
  }

  async listPaths(): Promise<string[]> {
    return [...this.entryMap.keys()];
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    const entry = this.getEntry(path);
    assertMaterializable(path, entry.sizeBytes ?? undefined, this.limits);
    const res = await this.fetchEntry(path);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${path}`);
    }

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? Number(contentLength) : undefined;
    if (total !== undefined && (!Number.isSafeInteger(total) || total < 0)) {
      throw new DataSourceSafetyError(
        'MANIFEST_INVALID',
        'Response has an invalid content length',
        {
          path,
          contentLength,
        },
      );
    }
    assertMaterializable(path, total, this.limits);
    if (!res.body) throw new Error(`HTTP response has no readable body fetching ${path}`);

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    onProgress?.({ phase: 'download', loaded: 0, total, message: path });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > this.limits.maxMaterializedBytes) {
        await reader.cancel();
        throw new DataSourceSafetyError(
          'MATERIALIZED_SIZE_LIMIT',
          'Remote file exceeded the in-memory size limit while downloading',
          { path, loaded, limit: this.limits.maxMaterializedBytes },
        );
      }
      chunks.push(value);
      onProgress?.({ phase: 'download', loaded, total, message: path });
    }

    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  /**
   * Size from the manifest, or from a one-byte Range GET (`Content-Range: bytes 0-0/<size>`) when
   * the manifest has none. Not HEAD: a presigned URL is signed for GET only, and S3-style stores
   * refuse HEAD on it. Cross-origin stores must expose `Content-Range`
   * (`Access-Control-Expose-Headers`); without it, or the size is unreadable, this throws
   * `SizeUnavailableError` (not repeated for a minute) and the loader reads the whole file instead.
   * Other failures (network, refused) throw as they are and are asked again.
   */
  async getSize(path: string): Promise<number> {
    const entry = this.getEntry(path);
    if (entry.sizeBytes != null) return entry.sizeBytes;
    const key = normalizePath(path);
    const failure = this.sizeFailures.get(key);
    if (failure && Date.now() - failure.at < SIZE_FAILURE_TTL_MS) throw failure.error;
    let lookup = this.sizeLookups.get(key);
    if (!lookup) {
      lookup = this.fetchEntry(path, { headers: { Range: 'bytes=0-0' } }).then(async (res) => {
        const size = sizeFromResponse(res);
        await res.body?.cancel().catch(() => undefined);
        if (size !== null) return size;
        // a failed request is not an answer about the size: asked again
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching the size of ${path}`);
        throw new SizeUnavailableError(path, res.status);
      });
      lookup.catch((error: unknown) => {
        this.sizeLookups.delete(key);
        // only a definitive answer (the store hides the size) is remembered; a network error or
        // a refused request is asked again
        if (error instanceof SizeUnavailableError) {
          this.sizeFailures.set(key, { at: Date.now(), error });
        }
      });
      this.sizeLookups.set(key, lookup);
    }
    return lookup;
  }

  /** One HTTP Range request; a server that ignores Range is refused rather than downloaded whole. */
  async readRange(
    path: string,
    offset: number,
    length: number,
    options?: RangeReadOptions,
  ): Promise<Uint8Array> {
    this.getEntry(path);
    options?.signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0
    ) {
      throw new DataSourceSafetyError('MANIFEST_INVALID', 'Invalid byte range', {
        path,
        offset,
        length,
      });
    }
    if (length === 0) return new Uint8Array(0);
    assertMaterializable(path, length, this.limits);
    const res = await this.fetchEntry(path, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      signal: options?.signal,
    });
    if (res.status === 206) {
      return new Uint8Array(await res.arrayBuffer());
    }
    if (res.ok) {
      await res.body?.cancel();
      throw new RangeNotSupportedError(path, res.status);
    }
    throw new Error(`HTTP ${res.status} fetching ${path}`);
  }

  /**
   * Returns the presigned URL directly so the browser can stream the file
   * (e.g. video) via HTTP Range requests without downloading it entirely.
   */
  async getObjectUrl(path: string): Promise<string> {
    this.getEntry(path);
    if (this.staleUrls.delete(normalizePath(path))) await this.renew(true);
    else await this.renew(false);
    return this.getEntry(path).presignedUrl;
  }

  /** Expiry of the current presigned URL of `path` (epoch ms), or null when it has none. */
  getUrlExpiry(path: string): number | null {
    const expiresAt = this.entryMap.get(normalizePath(path))?.expiresAt;
    const expiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    return Number.isFinite(expiry) ? expiry : null;
  }

  clear(): void {
    // No blob URLs to revoke; presigned URLs are external references.
  }

  /** A media element failed on this URL (likely expired): the next `getObjectUrl` renews first. */
  invalidateObjectUrl(path: string): void {
    this.staleUrls.add(normalizePath(path));
  }

  private getEntry(path: string): RemoteFileEntry {
    const entry = this.entryMap.get(normalizePath(path));
    if (!entry) {
      throw new Error(`File not found in manifest: ${path}`);
    }
    return entry;
  }
}

/** The server answered a Range request with the whole file: the caller reads the file whole. */
export class RangeNotSupportedError extends Error {
  readonly code = 'RANGE_NOT_SUPPORTED';
  constructor(path: string, status: number) {
    super(`HTTP ${status} without a byte range fetching ${path}: the server ignored Range`);
    this.name = 'RangeNotSupportedError';
  }
}

/**
 * The server answered the size lookup but the size cannot be read (a cross-origin store that does
 * not expose `Content-Range`): a definitive answer, the caller reads the file whole.
 */
export class SizeUnavailableError extends Error {
  readonly code = 'SIZE_UNAVAILABLE';
  constructor(path: string, status: number) {
    super(`HTTP ${status}: no size for ${path} (Content-Range not readable)`);
    this.name = 'SizeUnavailableError';
  }
}

/** Total size from a `bytes=0-0` response: `Content-Range` of a 206, or the length of a 200. */
function sizeFromResponse(res: Response): number | null {
  if (res.status === 206) {
    const match = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    const size = match ? Number(match[1]) : Number.NaN;
    return Number.isSafeInteger(size) && size >= 0 ? size : null;
  }
  if (res.ok) {
    const length = Number(res.headers.get('content-length'));
    return res.headers.has('content-length') && Number.isSafeInteger(length) && length >= 0
      ? length
      : null;
  }
  return null;
}

function validateManifestUrl(
  rawUrl: string,
  limits: Readonly<DataSourceSafetyLimits>,
  path: string,
): void {
  if (!rawUrl || rawUrl.length > limits.maxManifestUrlLength) {
    throw new DataSourceSafetyError('URL_INVALID', 'Manifest URL is empty or too long', {
      path,
      urlLength: rawUrl?.length ?? 0,
      limit: limits.maxManifestUrlLength,
    });
  }
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error('unsupported protocol');
    if (!url.hostname || url.username || url.password) throw new Error('invalid authority');
  } catch {
    throw new DataSourceSafetyError('URL_INVALID', 'Manifest URL must be an HTTP(S) URL', { path });
  }
}
