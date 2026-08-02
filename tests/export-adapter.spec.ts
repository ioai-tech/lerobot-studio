import { describe, expect, it, vi } from 'vitest';
import { WebExportAdapter } from '@ioai/lerobot-studio-platform';

class MockDirectoryHandle implements Partial<FileSystemDirectoryHandle> {
  kind = 'directory' as const;
  name: string;
  private children = new Map<string, MockDirectoryHandle | MockFileHandle>();
  public readonly getDirCalls: string[] = [];
  public readonly getFileCalls: string[] = [];

  constructor(
    name: string,
    public readonly root?: MockDirectoryHandle,
  ) {
    this.name = name;
  }

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    (this.root ?? this).getDirCalls.push(`${this.name}/${name}`);
    const existing = this.children.get(name);
    if (existing && (existing as MockDirectoryHandle).kind === 'directory') {
      return existing as unknown as FileSystemDirectoryHandle;
    }
    if (!opts?.create) throw new Error(`no dir ${name}`);
    const dir = new MockDirectoryHandle(name, this.root ?? this);
    this.children.set(name, dir);
    return dir as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle> {
    (this.root ?? this).getFileCalls.push(`${this.name}/${name}`);
    const existing = this.children.get(name);
    if (existing && (existing as MockFileHandle).kind === 'file') {
      return existing as unknown as FileSystemFileHandle;
    }
    if (!opts?.create) throw new Error(`no file ${name}`);
    const file = new MockFileHandle(name);
    this.children.set(name, file);
    return file as unknown as FileSystemFileHandle;
  }

  getChild(name: string): MockDirectoryHandle | MockFileHandle | undefined {
    return this.children.get(name);
  }
}

class MockWritable {
  public chunks: Uint8Array[] = [];
  public closed = false;
  async write(data: Uint8Array) {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    this.chunks.push(copy);
  }
  async close() {
    this.closed = true;
  }
}

class MockFileHandle {
  kind = 'file' as const;
  public writable = new MockWritable();
  constructor(public readonly name: string) {}
  async createWritable(): Promise<MockWritable> {
    this.writable = new MockWritable();
    return this.writable;
  }
}

describe('WebExportAdapter.finalizeDirectory', () => {
  it('caches directory handles per parent path rather than re-resolving for each file', async () => {
    const root = new MockDirectoryHandle('');
    const adapter = new WebExportAdapter({
      directoryHandle: root as unknown as FileSystemDirectoryHandle,
      directoryConcurrency: 2,
    });
    for (let i = 0; i < 5; i++) {
      await adapter.writeFile(`data/chunk-000/file-${i}.parquet`, new Uint8Array([i]));
    }
    for (let i = 0; i < 3; i++) {
      await adapter.writeFile(
        `meta/episodes/chunk-000/file-${i}.parquet`,
        new Uint8Array([10 + i]),
      );
    }
    await adapter.writeFile('meta/info.json', new Uint8Array([42]));

    await adapter.finalize('directory');

    const dataChunk = (root.getChild('data') as MockDirectoryHandle).getChild(
      'chunk-000',
    ) as MockDirectoryHandle;
    expect(dataChunk).toBeDefined();

    // 'data' + 'data/chunk-000' should each be resolved exactly once regardless
    // of how many files live beneath them.
    const dataCalls = root.getDirCalls.filter((c) => c === '/data').length;
    const dataChunkCalls = root.getDirCalls.filter((c) => c === 'data/chunk-000').length;
    expect(dataCalls).toBe(1);
    expect(dataChunkCalls).toBe(1);
  });

  it('writes file contents through createWritable + close and marks writable closed', async () => {
    const root = new MockDirectoryHandle('');
    const adapter = new WebExportAdapter({
      directoryHandle: root as unknown as FileSystemDirectoryHandle,
      directoryConcurrency: 1,
    });
    await adapter.writeFile('a.txt', new Uint8Array([1, 2, 3]));
    await adapter.finalize('directory');
    const file = root.getChild('a.txt') as MockFileHandle;
    expect(file.writable.closed).toBe(true);
    expect(file.writable.chunks.length).toBe(1);
    expect(Array.from(file.writable.chunks[0])).toEqual([1, 2, 3]);
  });
});

describe('WebExportAdapter.finalizeZip', () => {
  it('defers URL.revokeObjectURL so Safari does not abort the download mid-stream', async () => {
    vi.useFakeTimers();
    const createSpy = vi.fn(() => 'blob://fake');
    const revokeSpy = vi.fn();
    const g = globalThis as unknown as {
      URL?: unknown;
      document?: unknown;
    };
    const originalUrl = g.URL;
    const originalDocument = g.document;
    g.URL = {
      ...(originalUrl as object),
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    };

    const clicks: unknown[] = [];
    const removedEls: unknown[] = [];
    const appended: unknown[] = [];
    const mockAnchor = {
      href: '',
      download: '',
      rel: '',
      style: {},
      click: vi.fn(() => clicks.push(true)),
      remove: vi.fn(() => removedEls.push(true)),
    };
    g.document = {
      createElement: vi.fn(() => mockAnchor),
      body: {
        appendChild: vi.fn((node: unknown) => {
          appended.push(node);
          return node;
        }),
      },
    };

    try {
      const adapter = new WebExportAdapter({ useWebWorkers: false, zipFilename: 'test.zip' });
      await adapter.writeFile('a.txt', new Uint8Array([1]));
      await adapter.finalize('zip');

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).not.toHaveBeenCalled();
      expect(clicks.length).toBe(1);
      expect(appended.length).toBe(1);
      vi.advanceTimersByTime(61_000);
      expect(revokeSpy).toHaveBeenCalledWith('blob://fake');
      expect(removedEls.length).toBe(1);
    } finally {
      g.URL = originalUrl;
      g.document = originalDocument;
      vi.useRealTimers();
    }
  });
});
