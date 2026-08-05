import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DataSource, ProgressHandler } from '@/platform';

export class LocalFsDataSource implements DataSource {
  constructor(private readonly rootDir: string) {}

  private resolvePath(relativePath: string): string {
    return path.join(this.rootDir, relativePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async readText(relativePath: string, _onProgress?: ProgressHandler): Promise<string> {
    return fs.readFile(this.resolvePath(relativePath), 'utf-8');
  }

  async readBytes(relativePath: string, _onProgress?: ProgressHandler): Promise<Uint8Array> {
    const buffer = await fs.readFile(this.resolvePath(relativePath));
    return new Uint8Array(buffer);
  }

  async getObjectUrl(_relativePath: string): Promise<string> {
    throw new Error('getObjectUrl is not supported in parser tests');
  }

  clear(): void {
    // no-op for local fs source
  }
}
