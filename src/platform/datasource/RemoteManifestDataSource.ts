import type { DataSource, ProgressHandler } from './dataSources';

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
  private readonly urlMap: Map<string, string>;

  constructor(files: RemoteFileEntry[]) {
    this.urlMap = new Map(files.map((f) => [normalizePath(f.logicalPath), f.presignedUrl]));
  }

  async exists(path: string): Promise<boolean> {
    return this.urlMap.has(normalizePath(path));
  }

  async readText(path: string): Promise<string> {
    const url = this.getUrl(path);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${path}`);
    }
    return res.text();
  }

  async readBytes(path: string, onProgress?: ProgressHandler): Promise<Uint8Array> {
    const url = this.getUrl(path);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${path}`);
    }

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : undefined;

    if (!onProgress || !res.body) {
      return new Uint8Array(await res.arrayBuffer());
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    onProgress({ phase: 'download', loaded: 0, total, message: path });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress({ phase: 'download', loaded, total, message: path });
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
    const url = this.urlMap.get(normalizePath(path));
    if (!url) {
      throw new Error(`File not found in manifest: ${path}`);
    }
    return url;
  }
}
