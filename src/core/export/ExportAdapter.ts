/**
 * Platform-agnostic export adapter interface.
 * Web implementation writes to an in-memory map then packages (ZIP/tar.gz) or writes to directory.
 * React Native implementation (future) would write directly to RNFS.
 */

export type ExportFormat = 'zip' | 'directory';

export interface ExportAdapter {
  writeFile(path: string, content: Uint8Array): void | Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  createDirectory(path: string): void | Promise<void>;
  hasFile(path: string): boolean;
  listFiles(): string[];
  finalize(format: ExportFormat): Promise<void>;
  clear(): void;
}
