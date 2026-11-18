import type { ByteRangeResult, DataSource, ProgressHandler } from '../../core/datasource/types';
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
  /**
   * Optional size in bytes; used by safety limits and to read parquet footers
   * and column chunks with plain `bytes=a-b` ranges (without it the viewer
   * needs a readable `Content-Range` response header).
   */
  sizeBytes?: number | null;
  /**
   * Optional ISO 8601 time at which `presignedUrl` stops working. The viewer
   * refreshes the manifest shortly before it (see `refresh`).
   */
  expiresAt?: string | null;
}

/** Options for a remote file manifest. */
export interface RemoteManifestOptions {
  /**
   * Return a fresh manifest (same logical paths, new URLs). Called once for
   * the whole manifest when a read fails with 401/403 or a URL is within 60 s
   * of its expiry; concurrent failures share one call. Paths the result does
   * not list keep their URL; new paths are ignored.
   */
  refresh?: () => Promise<RemoteFileEntry[] | RemoteManifestRefreshResult>;
  /**
   * Default ISO 8601 expiry for the initial entries without their own
   * `expiresAt`. A refresh replaces it: refreshed entries expire at their own
   * `expiresAt`, else at the refresh result's `expiresAt`, else at an unknown
   * time (then only a 401/403 triggers the next refresh).
   */
  expiresAt?: string | null;
  /**
   * Dataset `episode_index` values to show. Only those episodes are listed
   * and read; the health report marks the others as not evaluated.
   */
  episodeScope?: readonly number[];
}

/** What `refresh` may return when the new URLs share one expiry. */
export interface RemoteManifestRefreshResult {
  files: RemoteFileEntry[];
  /** Default ISO 8601 expiry for the returned entries without their own `expiresAt`. */
  expiresAt?: string | null;
}

/** Validate a host-given episode scope (non-negative integers, deduplicated, sorted). */
export function normalizeEpisodeScope(
  scope: readonly number[] | undefined,
): readonly number[] | undefined {
  if (scope === undefined) return undefined;
  if (!Array.isArray(scope)) {
    throw new DataSourceSafetyError('MANIFEST_INVALID', 'episodeScope must be an array', {});
  }
  for (const value of scope) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DataSourceSafetyError(
        'MANIFEST_INVALID',
        'episodeScope must contain non-negative integers',
        { value },
      );
    }
  }
  return Object.freeze([...new Set(scope)].sort((a, b) => a - b));
}

interface ManifestEntryState {
  entry: RemoteFileEntry;
  expiresAtMs: number | null;
}

/**
 * A DataSource backed by a manifest of presigned URLs.
 *
 * Files are fetched on demand via HTTP fetch using the presigned URLs.
 * Video files served via getObjectUrl() are streamed directly by the browser
 * without downloading the entire file first, enabling playback of large
 * remote datasets without loading all data upfront. With `refresh`, expired
 * or rejected URLs are renewed once and the read retried once.
 */
export class RemoteManifestDataSource implements DataSource {
  private readonly entryMap = new Map<string, ManifestEntryState>();
  private readonly limits: Readonly<DataSourceSafetyLimits>;
  private readonly refreshManifest: RemoteManifestOptions['refresh'] | null;
  private readonly refreshCoalescer = new Coalescer();
  private readonly urlChanges = new UrlChangeEmitter();
  private readonly proactiveRefresh: ProactiveRefreshTimer;
  readonly episodeScope?: readonly number[];

  constructor(
    files: RemoteFileEntry[],
    limitOverrides?: Partial<DataSourceSafetyLimits>,
    options: RemoteManifestOptions = {},
  ) {
    this.limits = resolveSafetyLimits(limitOverrides);
    this.refreshManifest = options.refresh ?? null;
    const defaultExpiresAtMs = parseExpiresAt(options.expiresAt);
    const scope = normalizeEpisodeScope(options.episodeScope);
    if (scope) this.episodeScope = scope;
    this.proactiveRefresh = new ProactiveRefreshTimer(
      () => this.earliestExpiry(),
      () => this.refresh(),
      () => this.refreshManifest !== null && this.urlChanges.size > 0,
    );
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
      this.entryMap.set(path, {
        entry: file,
        expiresAtMs: parseExpiresAt(file.expiresAt) ?? defaultExpiresAtMs,
      });
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.entryMap.has(normalizeLogicalPath(path));
  }

  async listPaths(): Promise<string[]> {
    return [...this.entryMap.keys()];
  }

  async readText(path: string, onProgress?: ProgressHandler): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path, onProgress));
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    const state = this.getState(path);
    assertMaterializable(path, state.entry.sizeBytes ?? undefined, this.limits);
    const res = await fetchWithRefresh(path, () => this.getUrl(path), this.urlRefresher());
    return readResponseBytes(res, path, this.limits, onProgress);
  }

  /** Read part of a file with an HTTP Range request (see `DataSource.readRange`). */
  async readRange(path: string, start: number, end?: number): Promise<ByteRangeResult> {
    const state = this.getState(path);
    return fetchByteRange(
      path,
      () => this.getUrl(path),
      this.urlRefresher(),
      state.entry.sizeBytes ?? null,
      start,
      end,
      this.limits,
    );
  }

  /**
   * Returns the presigned URL directly so the browser can stream the file
   * (e.g. video) via HTTP Range requests without downloading it entirely.
   * Refreshes first when the URL is within 60 s of its expiry.
   */
  async getObjectUrl(path: string): Promise<string> {
    return this.getUrl(path);
  }

  clear(): void {
    // No blob URLs to revoke; presigned URLs are external references.
    this.proactiveRefresh.cancel();
    this.urlChanges.clear();
  }

  /** A consumer reports that the URL for `path` failed: refresh once (coalesced). */
  async invalidateObjectUrl(_path: string): Promise<void> {
    if (this.refreshManifest) await this.refresh();
  }

  subscribeUrlChanges(listener: (paths: readonly string[]) => void): () => void {
    return this.urlChanges.subscribe(listener, () => this.proactiveRefresh.reschedule());
  }

  /** Refresh every URL once; concurrent callers share the same request. */
  refresh(): Promise<void> {
    if (!this.refreshManifest) return Promise.resolve();
    return this.refreshCoalescer.run(() => this.refreshNow());
  }

  private async refreshNow(): Promise<void> {
    const refreshManifest = this.refreshManifest;
    if (!refreshManifest) return;
    const result = await refreshManifest();
    const files = Array.isArray(result) ? result : (result?.files ?? []);
    const resultExpiresAtMs = Array.isArray(result) ? null : parseExpiresAt(result?.expiresAt);
    const changed: string[] = [];
    for (const file of files) {
      let path: string;
      try {
        path = validateUntrustedPath(file.logicalPath, this.limits);
      } catch {
        continue;
      }
      const state = this.entryMap.get(path);
      if (!state) continue;
      validateManifestUrl(file.presignedUrl, this.limits, path);
      const previousUrl = state.entry.presignedUrl;
      state.entry = {
        ...state.entry,
        presignedUrl: file.presignedUrl,
        expiresAt: file.expiresAt,
      };
      // The refresh owns the expiry now; the initial manifest default no longer applies.
      state.expiresAtMs = parseExpiresAt(file.expiresAt) ?? resultExpiresAtMs;
      if (previousUrl !== file.presignedUrl) changed.push(path);
    }
    this.urlChanges.emit(changed);
    this.proactiveRefresh.reschedule();
  }

  private urlRefresher(): UrlRefresher | null {
    if (!this.refreshManifest) return null;
    return {
      generation: () => this.refreshCoalescer.generation,
      refreshSince: (seen) => this.refreshCoalescer.runSince(seen, () => this.refreshNow()),
    };
  }

  private earliestExpiry(): number | null {
    let earliest: number | null = null;
    for (const state of this.entryMap.values()) {
      if (state.expiresAtMs != null && (earliest == null || state.expiresAtMs < earliest)) {
        earliest = state.expiresAtMs;
      }
    }
    return earliest;
  }

  private async getUrl(path: string): Promise<string> {
    const state = this.getState(path);
    if (this.refreshManifest && this.refreshCoalescer.shouldRefreshForExpiry(state.expiresAtMs)) {
      await this.refresh();
    }
    return this.getState(path).entry.presignedUrl;
  }

  private getState(path: string): ManifestEntryState {
    const state = this.entryMap.get(normalizeLogicalPath(path));
    if (!state) {
      throw new Error(`File not found in manifest: ${path}`);
    }
    return state;
  }
}

export function validateManifestUrl(
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
