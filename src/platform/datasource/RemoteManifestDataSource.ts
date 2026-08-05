import type { DataSource, ProgressHandler } from './dataSources';
import {
  assertMaterializable,
  DataSourceSafetyError,
  type DataSourceSafetyLimits,
  resolveSafetyLimits,
  validateUntrustedPath,
} from './inputSafety';

export interface RemoteFileEntry {
  logicalPath: string;
  presignedUrl: string;
  contentType?: string | null;
  sizeBytes?: number | null;
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

  constructor(files: RemoteFileEntry[], limitOverrides?: Partial<DataSourceSafetyLimits>) {
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
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.entryMap.has(normalizePath(path));
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    const entry = this.getEntry(path);
    const url = entry.presignedUrl;
    assertMaterializable(path, entry.sizeBytes ?? undefined, this.limits);
    const res = await fetch(url);
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
   * Returns the presigned URL directly so the browser can stream the file
   * (e.g. video) via HTTP Range requests without downloading it entirely.
   */
  async getObjectUrl(path: string): Promise<string> {
    return this.getUrl(path);
  }

  clear(): void {
    // No blob URLs to revoke; presigned URLs are external references.
  }

  invalidateObjectUrl(_path: string): void {
    // no-op: presigned URLs are not cached as blob URLs here
  }

  private getUrl(path: string): string {
    return this.getEntry(path).presignedUrl;
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
