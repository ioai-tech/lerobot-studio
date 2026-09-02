import type { ExportAdapter, ExportFormat } from '@/core';
import { canUseFileSystemAccess } from '../utils/fsPermissions';

export interface WebExportAdapterOptions {
  /** When exporting to directory, pass a handle obtained during user gesture (e.g. from showDirectoryPicker). */
  directoryHandle?: FileSystemDirectoryHandle | null;
  /** Maximum parallel writes during directory finalize. */
  directoryConcurrency?: number;
  /** Whether the ZIP writer should use web workers for deflate. */
  useWebWorkers?: boolean;
  /** Output filename used when finalizing as zip. */
  zipFilename?: string;
}

const DEFAULT_DIR_CONCURRENCY = 8;

/**
 * In-memory file store; finalize() either triggers download (zip) or writes to directory via File System Access API.
 * For directory export, directoryHandle must be provided (obtained by showDirectoryPicker in the same user gesture as export).
 */
export class WebExportAdapter implements ExportAdapter {
  private files = new Map<string, Uint8Array>();
  private directoryHandle: FileSystemDirectoryHandle | null;
  private directoryConcurrency: number;
  private useWebWorkers: boolean;
  private zipFilename: string;

  constructor(options?: WebExportAdapterOptions) {
    this.directoryHandle = options?.directoryHandle ?? null;
    this.directoryConcurrency = options?.directoryConcurrency ?? DEFAULT_DIR_CONCURRENCY;
    this.useWebWorkers = options?.useWebWorkers ?? true;
    this.zipFilename = options?.zipFilename ?? 'lerobot-export.zip';
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file;
  }

  async createDirectory(path: string): Promise<void> {
    void path; // No-op for in-memory; directory structure is implied by file paths
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  clear(): void {
    this.files.clear();
  }

  async finalize(format: ExportFormat): Promise<void> {
    if (format === 'directory') {
      await this.finalizeDirectory();
    } else {
      await this.finalizeZip();
    }
  }

  private async finalizeDirectory(): Promise<void> {
    const dirHandle = this.directoryHandle;
    if (!dirHandle) {
      if (!canUseFileSystemAccess()) {
        throw new Error('File System Access API is not supported');
      }
      throw new Error(
        'Export to directory requires choosing a folder first. Use showDirectoryPicker() in the same user gesture as the export button click, then pass the handle to WebExportAdapter.',
      );
    }

    // Cache parent directory handles so we don't walk the tree per file.
    const dirCache = new Map<string, FileSystemDirectoryHandle>();
    dirCache.set('', dirHandle);

    const ensureDir = async (parts: string[]): Promise<FileSystemDirectoryHandle> => {
      let cumulative = '';
      let current: FileSystemDirectoryHandle = dirHandle;
      for (const p of parts) {
        cumulative = cumulative === '' ? p : `${cumulative}/${p}`;
        const cached = dirCache.get(cumulative);
        if (cached) {
          current = cached;
          continue;
        }
        current = await current.getDirectoryHandle(p, { create: true });
        dirCache.set(cumulative, current);
      }
      return current;
    };

    const entries = Array.from(this.files.entries());
    // Pre-create all parent directories sequentially (cheap, few hundred entries)
    // so file writes don't race on createDirectory calls.
    const uniqueParents = new Set<string>();
    for (const [path] of entries) {
      const parts = path.split('/');
      parts.pop();
      uniqueParents.add(parts.join('/'));
    }
    for (const parent of Array.from(uniqueParents).sort()) {
      if (parent === '') continue;
      await ensureDir(parent.split('/'));
    }

    const writeOne = async (path: string, content: Uint8Array) => {
      const parts = path.split('/');
      const fileName = parts.pop()!;
      const currentDir = parts.length > 0 ? await ensureDir(parts) : dirHandle;
      const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        // Cast: `Uint8Array<ArrayBufferLike>` isn't assignable to the DOM's
        // `FileSystemWriteChunkType` (which wants an `ArrayBuffer`-backed
        // view) under strict TS libs, but at runtime any Uint8Array works.
        await writable.write(content as unknown as BufferSource);
      } finally {
        await writable.close();
      }
    };

    // Parallel writes with bounded concurrency.
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, this.directoryConcurrency) }, async () => {
      while (cursor < entries.length) {
        const idx = cursor++;
        const [path, content] = entries[idx];
        await writeOne(path, content);
      }
    });
    await Promise.all(workers);
  }

  private async finalizeZip(): Promise<void> {
    const { ZipWriter, BlobWriter, Uint8ArrayReader } = await import('@zip.js/zip.js');
    const blobWriter = new BlobWriter('application/zip');
    const zipWriter = new ZipWriter(blobWriter, { useWebWorkers: this.useWebWorkers });
    try {
      for (const [path, content] of this.files.entries()) {
        await zipWriter.add(path, new Uint8ArrayReader(content));
      }
    } catch (err) {
      // Clean up any worker pool even if we throw.
      try {
        await zipWriter.close();
      } catch {
        /* ignore secondary error */
      }
      throw err;
    }
    const blob = await zipWriter.close();
    this.downloadBlob(blob, this.zipFilename);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Delay revocation so some browsers (notably Safari) don't abort the
    // download on immediate cleanup. 60s is plenty for any in-flight download
    // to have actually begun streaming bytes.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 60_000);
  }
}
