import type { DataSource, ProgressHandler } from '@/platform';

/**
 * A minimal DataSource that reads relative paths from the dev server's static
 * file serving (where Vite exposes `examples/` from the workspace root).
 */
export class FetchDataSource implements DataSource {
  private objectUrls = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  private resolve(p: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const res = await fetch(this.resolve(relativePath), { headers: { Range: 'bytes=0-0' } });
      return res.ok;
    } catch {
      return false;
    }
  }

  async readText(relativePath: string, _onProgress?: ProgressHandler): Promise<string> {
    const res = await fetch(this.resolve(relativePath));
    if (!res.ok) throw new Error(`fetch ${relativePath} -> ${res.status}`);
    return res.text();
  }

  async readBytes(relativePath: string, _onProgress?: ProgressHandler): Promise<Uint8Array> {
    const res = await fetch(this.resolve(relativePath));
    if (!res.ok) throw new Error(`fetch ${relativePath} -> ${res.status}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  async getObjectUrl(relativePath: string): Promise<string> {
    const cached = this.objectUrls.get(relativePath);
    if (cached) return cached;
    const bytes = await this.readBytes(relativePath);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(relativePath, url);
    return url;
  }

  clear(): void {
    for (const url of this.objectUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    this.objectUrls.clear();
  }
}

/** Has the first four bytes of an MP4's `ftyp` box signature. */
export function isMp4Container(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[4] === 0x66 /* f */ &&
    bytes[5] === 0x74 /* t */ &&
    bytes[6] === 0x79 /* y */ &&
    bytes[7] === 0x70 /* p */
  );
}
