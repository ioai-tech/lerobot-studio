import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHandles,
  deleteHandle,
  getHandle,
  putHandle,
  resetHandleStoreForTests,
} from '@ioai/lerobot-studio-platform';

type StoreRecord = Map<string, FileSystemHandle>;

function createMockIndexedDB(store: StoreRecord) {
  const mockStore = {
    put: vi.fn((value: FileSystemHandle, key: string) => {
      const request = {
        result: key,
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        store.set(key, value);
        request.onsuccess?.();
      });
      return request;
    }),
    get: vi.fn((key: string) => {
      const request = {
        result: store.get(key),
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        request.onsuccess?.();
      });
      return request;
    }),
    delete: vi.fn((key: string) => {
      const request = {
        result: undefined,
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        store.delete(key);
        request.onsuccess?.();
      });
      return request;
    }),
    clear: vi.fn(() => {
      const request = {
        result: undefined,
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => {
        store.clear();
        request.onsuccess?.();
      });
      return request;
    }),
  };

  const mockDb = {
    objectStoreNames: {
      contains: vi.fn(() => true),
    },
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => ({
      objectStore: vi.fn(() => mockStore),
      onerror: null as (() => void) | null,
    })),
  };

  const indexedDB = {
    open: vi.fn((_name: string, _version?: number) => {
      const request = {
        result: mockDb,
        error: null as DOMException | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as ((event: { target: { result: typeof mockDb } }) => void) | null,
      };
      queueMicrotask(() => {
        request.onsuccess?.();
      });
      return request;
    }),
  };

  return { indexedDB, store };
}

describe('handleStore', () => {
  let memoryStore: StoreRecord;

  beforeEach(() => {
    memoryStore = new Map();
    resetHandleStoreForTests();
    const { indexedDB } = createMockIndexedDB(memoryStore);
    vi.stubGlobal('indexedDB', indexedDB);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetHandleStoreForTests();
  });

  it('stores and retrieves a FileSystemHandle by id', async () => {
    const handle = { kind: 'directory', name: 'dataset' } as FileSystemDirectoryHandle;

    await expect(putHandle('directory:folder://dataset', handle)).resolves.toBe(true);
    await expect(getHandle('directory:folder://dataset')).resolves.toBe(handle);
  });

  it('deletes a stored handle', async () => {
    const handle = { kind: 'file', name: 'data.zip' } as FileSystemFileHandle;
    await putHandle('localArchive:file://data.zip', handle);

    await deleteHandle('localArchive:file://data.zip');

    await expect(getHandle('localArchive:file://data.zip')).resolves.toBeNull();
  });

  it('clears all stored handles', async () => {
    await putHandle('a', { kind: 'file', name: 'a.zip' } as FileSystemFileHandle);
    await putHandle('b', { kind: 'directory', name: 'b' } as FileSystemDirectoryHandle);

    await clearHandles();

    await expect(getHandle('a')).resolves.toBeNull();
    await expect(getHandle('b')).resolves.toBeNull();
  });

  it('returns false when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    resetHandleStoreForTests();

    const handle = { kind: 'file', name: 'x.zip' } as FileSystemFileHandle;
    await expect(putHandle('id', handle)).resolves.toBe(false);
    await expect(getHandle('id')).resolves.toBeNull();
  });
});
