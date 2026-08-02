import type { ExportAdapter, ExportFormat } from '@/core';

/**
 * In-memory export adapter used only in tests.
 *
 * Unlike `WebExportAdapter`, `finalize()` does not attempt to build a ZIP or
 * write to an actual directory; it simply marks the adapter as finalized and
 * keeps the written files around for assertions.
 */
export class InMemoryExportAdapter implements ExportAdapter {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>();
  private finalized = false;
  private finalizedFormat: ExportFormat | null = null;

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    // Copy bytes to detach from any caller-provided shared buffer so later
    // mutations don't leak into our snapshot.
    const copy = new Uint8Array(content.length);
    copy.set(content);
    this.files.set(path, copy);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file;
  }

  async createDirectory(path: string): Promise<void> {
    this.dirs.add(path);
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  listDirs(): string[] {
    return Array.from(this.dirs);
  }

  clear(): void {
    this.files.clear();
    this.dirs.clear();
    this.finalized = false;
    this.finalizedFormat = null;
  }

  async finalize(format: ExportFormat): Promise<void> {
    this.finalized = true;
    this.finalizedFormat = format;
  }

  isFinalized(): boolean {
    return this.finalized;
  }

  getFinalizedFormat(): ExportFormat | null {
    return this.finalizedFormat;
  }
}
