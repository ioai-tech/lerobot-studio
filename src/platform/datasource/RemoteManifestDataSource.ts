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

/** Renew this long before the earliest expiry, so a Range request never carries a dead URL. */
const REFRESH_MARGIN_MS = 2 * 60_000;

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

  /** Swap in fresh URLs for the paths this manifest already has; new or missing paths are ignored. */
  private applyRefresh(files: RemoteFileEntry[]): void {
    this.earliestExpiry = Number.POSITIVE_INFINITY;
    for (const file of files) {
      const path = validateUntrustedPath(file.logicalPath, this.limits);
      const current = this.entryMap.get(path);
      if (!current) continue;
      validateManifestUrl(file.presignedUrl, this.limits, path);
      const next = { ...current, presignedUrl: file.presignedUrl, expiresAt: file.expiresAt };
      this.entryMap.set(path, next);
      this.noteExpiry(next);
    }
  }

  /** Renew the URLs once for all concurrent callers; `force` after a refused request. */
  private async renew(force: boolean): Promise<boolean> {
    if (!this.refreshManifest) return false;
    if (!force && this.earliestExpiry - Date.now() > REFRESH_MARGIN_MS) return false;
    if (!this.refreshing) {
      this.refreshing = this.refreshManifest()
        .then((files) => this.applyRefresh(files))
        .finally(() => {
          this.refreshing = null;
        });
    }
    await this.refreshing;
    return true;
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

  /** Size from the manifest, or from a HEAD request when the manifest has none. */
  async getSize(path: string): Promise<number> {
    const entry = this.getEntry(path);
    if (entry.sizeBytes != null) return entry.sizeBytes;
    const key = normalizePath(path);
    let lookup = this.sizeLookups.get(key);
    if (!lookup) {
      lookup = this.fetchEntry(path, { method: 'HEAD' }).then((res) => {
        const length = Number(res.headers.get('content-length'));
        if (!res.ok || !Number.isSafeInteger(length) || length < 0) {
          throw new Error(`HTTP ${res.status} reading the size of ${path}`);
        }
        return length;
      });
      lookup.catch(() => this.sizeLookups.delete(key));
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
      throw new Error(
        `HTTP ${res.status} without a byte range fetching ${path}: the server ignored Range`,
      );
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
