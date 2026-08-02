import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ExportAdapter, ExportFormat } from '@ioai/lerobot-studio-core';

/** Filesystem-backed adapter for official Python round-trip compatibility tests. */
export class DirectoryExportAdapter implements ExportAdapter {
  private readonly files = new Set<string>();

  constructor(readonly root: string) {}

  private resolve(logicalPath: string): string {
    const normalized = path.posix.normalize(logicalPath);
    if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
      throw new Error(`Unsafe export path: ${logicalPath}`);
    }
    return path.join(this.root, normalized);
  }

  async writeFile(logicalPath: string, content: Uint8Array): Promise<void> {
    const target = this.resolve(logicalPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    this.files.add(logicalPath);
  }

  async readFile(logicalPath: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(this.resolve(logicalPath)));
  }

  async createDirectory(logicalPath: string): Promise<void> {
    await fs.mkdir(this.resolve(logicalPath), { recursive: true });
  }

  hasFile(logicalPath: string): boolean {
    return this.files.has(logicalPath);
  }

  listFiles(): string[] {
    return [...this.files].sort();
  }

  async finalize(format: ExportFormat): Promise<void> {
    if (format !== 'directory') {
      throw new Error('DirectoryExportAdapter only supports directory exports');
    }
  }

  clear(): void {
    this.files.clear();
  }
}
