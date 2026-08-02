import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceController, type SourceControllerDeps } from '../src/web/services/SourceController';
import type { DataSource } from '@/platform';
import type { HistoryItem } from '@';
import * as handleStore from '../src/platform/utils/handleStore.ts';
import * as fsPermissions from '../src/platform/utils/fsPermissions.ts';
import * as archiveFactory from '../src/platform/datasource/ArchiveDataSourceFactory.ts';
import * as remotePreflight from '../src/platform/datasource/remotePreflight.ts';
import { parseSourceUrl } from '../src/web/utils/sourceUrl';

vi.mock('../src/platform/utils/handleStore.ts', () => ({
  putHandle: vi.fn().mockResolvedValue(true),
  getHandle: vi.fn(),
  deleteHandle: vi.fn().mockResolvedValue(true),
  clearHandles: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/platform/utils/fsPermissions.ts', () => ({
  supportsHandlePersistence: vi.fn(() => true),
  verifyPermission: vi.fn(),
}));

vi.mock('../src/platform/datasource/ArchiveDataSourceFactory.ts', async () => {
  const actual = await vi.importActual<
    typeof import('../src/platform/datasource/ArchiveDataSourceFactory.ts')
  >('../src/platform/datasource/ArchiveDataSourceFactory.ts');
  const stubSource = {
    exists: async () => true,
    readText: async () => '',
    readBytes: async () => new Uint8Array(),
    getObjectUrl: async () => 'blob:test',
    clear: () => {},
  } satisfies DataSource;
  return {
    ...actual,
    createArchiveDataSourceFromFile: vi.fn(() => stubSource),
    createArchiveDataSourceFromUrl: vi.fn(() => stubSource),
  };
});

vi.mock('../src/platform/datasource/remotePreflight.ts', async () => {
  const actual = await vi.importActual<
    typeof import('../src/platform/datasource/remotePreflight.ts')
  >('../src/platform/datasource/remotePreflight.ts');
  return {
    ...actual,
    preflightRemoteArchive: vi.fn(async () => ({
      ok: true as const,
      kind: 'zip' as const,
      accessMode: 'range' as const,
    })),
  };
});

function createDeps() {
  const initialize = vi.fn<(source: DataSource) => Promise<void>>().mockResolvedValue(undefined);
  const deps: SourceControllerDeps = {
    initialize,
    reset: vi.fn().mockResolvedValue(undefined),
    upsertTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
    clearTasks: vi.fn(),
    addHistoryItem: vi.fn(),
    setDatasetLabel: vi.fn(),
    setWelcomeRequest: vi.fn(),
    t: (key: string) => key,
    showToast: vi.fn(),
  };

  return { deps, initialize };
}

describe('SourceController initialization', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {
        search: '',
        pathname: '/lerobot',
      },
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      showDirectoryPicker: vi.fn(),
      showOpenFilePicker: vi.fn(),
    });
    vi.mocked(handleStore.putHandle).mockResolvedValue(true);
    vi.mocked(fsPermissions.supportsHandlePersistence).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('initializes a directory handle exactly once', async () => {
    const { deps, initialize } = createDeps();
    const controller = new SourceController(deps);
    const handle = { name: 'dataset-root' } as FileSystemDirectoryHandle;

    await controller.openDirectoryHandle(handle);

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(deps.completeTask).toHaveBeenCalledWith('open-dir');
    expect(deps.failTask).not.toHaveBeenCalled();
    expect(handleStore.putHandle).toHaveBeenCalled();
    expect(deps.addHistoryItem).toHaveBeenCalledWith(expect.objectContaining({ hasHandle: true }));
  });

  it('initializes a selected directory file list exactly once', async () => {
    const { deps, initialize } = createDeps();
    const controller = new SourceController(deps);
    const files = [
      {
        name: 'info.json',
        webkitRelativePath: 'dataset-root/meta/info.json',
      },
    ] as unknown as File[];

    await controller.openDirectoryFiles(files);

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(deps.completeTask).toHaveBeenCalledWith('open-dir');
    expect(deps.failTask).not.toHaveBeenCalled();
    expect(handleStore.putHandle).not.toHaveBeenCalled();
  });

  it('persists file handle when opening local archive via handle', async () => {
    const { deps, initialize } = createDeps();
    const controller = new SourceController(deps);
    const file = new File(['zip'], 'archive.zip', { type: 'application/zip' });
    const fileHandle = {
      kind: 'file',
      name: 'archive.zip',
      getFile: vi.fn().mockResolvedValue(file),
    } as unknown as FileSystemFileHandle;

    await controller.openFile(file, fileHandle);

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(handleStore.putHandle).toHaveBeenCalled();
    expect(deps.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ hasHandle: true, kind: 'localArchive' }),
    );
  });

  it('forwards the full-download mode after a server ignores Range', async () => {
    vi.mocked(remotePreflight.preflightRemoteArchive).mockResolvedValueOnce({
      ok: true,
      kind: 'zip',
      accessMode: 'full',
      contentLength: 1024,
    });
    const { deps, initialize } = createDeps();
    const controller = new SourceController(deps);

    await controller.openRemoteArchive('https://example.com/archive.zip');

    expect(archiveFactory.createArchiveDataSourceFromUrl).toHaveBeenCalledWith(
      'https://example.com/archive.zip',
      expect.any(Function),
      'zip',
      { accessMode: 'full' },
    );
    expect(initialize).toHaveBeenCalledOnce();
  });
});

describe('SourceController restoreFromHistory', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {
        search: '',
        pathname: '/lerobot',
      },
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      showDirectoryPicker: vi.fn(),
      showOpenFilePicker: vi.fn(),
    });
    vi.mocked(fsPermissions.supportsHandlePersistence).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('restores a directory handle when permission is granted', async () => {
    const { deps, initialize } = createDeps();
    const controller = new SourceController(deps);
    const handle = { kind: 'directory', name: 'dataset-root' } as FileSystemDirectoryHandle;
    vi.mocked(handleStore.getHandle).mockResolvedValue(handle);
    vi.mocked(fsPermissions.verifyPermission).mockResolvedValue(true);

    const item: HistoryItem = {
      id: 'directory:folder://dataset-root',
      kind: 'directory',
      label: 'dataset-root',
      payload: { path: 'dataset-root', url: 'folder://dataset-root' },
      openedAt: Date.now(),
      hasHandle: true,
    };

    await controller.restoreFromHistory(item);

    expect(fsPermissions.verifyPermission).toHaveBeenCalledWith(handle, { mode: 'read' });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
  });

  it('falls back to directory picker when permission is denied', async () => {
    const { deps } = createDeps();
    const controller = new SourceController(deps);
    const handle = { kind: 'directory', name: 'dataset-root' } as FileSystemDirectoryHandle;
    vi.mocked(handleStore.getHandle).mockResolvedValue(handle);
    vi.mocked(fsPermissions.verifyPermission).mockResolvedValue(false);
    vi.mocked(window.showDirectoryPicker).mockRejectedValue(
      new DOMException('cancel', 'AbortError'),
    );

    const item: HistoryItem = {
      id: 'directory:folder://dataset-root',
      kind: 'directory',
      label: 'dataset-root',
      payload: { path: 'dataset-root' },
      openedAt: Date.now(),
      hasHandle: true,
    };

    await controller.restoreFromHistory(item);

    expect(deps.showToast).toHaveBeenCalledWith('source.restorePermissionDenied', 'warning');
    expect(window.showDirectoryPicker).toHaveBeenCalled();
  });

  it('deletes stale handle and falls back when file is missing', async () => {
    const { deps } = createDeps();
    const controller = new SourceController(deps);
    const fileHandle = {
      kind: 'file',
      name: 'archive.zip',
      getFile: vi.fn().mockRejectedValue(new DOMException('missing', 'NotFoundError')),
    } as unknown as FileSystemFileHandle;
    vi.mocked(handleStore.getHandle).mockResolvedValue(fileHandle);
    vi.mocked(fsPermissions.verifyPermission).mockResolvedValue(true);
    vi.mocked(window.showOpenFilePicker).mockRejectedValue(
      new DOMException('cancel', 'AbortError'),
    );

    const item: HistoryItem = {
      id: 'localArchive:file://archive.zip',
      kind: 'localArchive',
      label: 'archive.zip',
      payload: { path: 'archive.zip' },
      openedAt: Date.now(),
      hasHandle: true,
    };

    await controller.restoreFromHistory(item);

    expect(handleStore.deleteHandle).toHaveBeenCalledWith(item.id);
    expect(deps.showToast).toHaveBeenCalledWith('source.restoreHandleNotFound', 'warning');
    expect(window.showOpenFilePicker).toHaveBeenCalled();
  });

  it('falls back to picker when stored handle is missing', async () => {
    const { deps } = createDeps();
    const clearHistoryHandleFlag = vi.fn();
    deps.clearHistoryHandleFlag = clearHistoryHandleFlag;
    const controller = new SourceController(deps);
    vi.mocked(handleStore.getHandle).mockResolvedValue(null);
    vi.mocked(window.showDirectoryPicker).mockRejectedValue(
      new DOMException('cancel', 'AbortError'),
    );

    const item: HistoryItem = {
      id: 'directory:folder://dataset-root',
      kind: 'directory',
      label: 'dataset-root',
      payload: { path: 'dataset-root' },
      openedAt: Date.now(),
      hasHandle: true,
    };

    await controller.restoreFromHistory(item);

    expect(clearHistoryHandleFlag).toHaveBeenCalledWith(item.id);
    expect(deps.showToast).toHaveBeenCalledWith('source.restoreHandleMissing', 'warning');
    expect(window.showDirectoryPicker).toHaveBeenCalled();
  });
});

describe('SourceController tryRestoreFromUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { search: '', pathname: '/lerobot' },
      history: { pushState: vi.fn(), replaceState: vi.fn() },
    });
    vi.mocked(fsPermissions.supportsHandlePersistence).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('auto-restores on refresh when queryPermission is already granted', async () => {
    const { deps, initialize } = createDeps();
    const controller = new SourceController(deps);
    const handle = {
      kind: 'file',
      name: 'data.tar.gz',
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn(),
      getFile: vi.fn().mockResolvedValue(new File(['x'], 'data.tar.gz')),
    } as unknown as FileSystemFileHandle;
    vi.mocked(handleStore.getHandle).mockResolvedValue(handle);

    const parsed = parseSourceUrl('file://data.tar.gz');
    const result = await controller.tryRestoreFromUrl(parsed, { allowRequest: false });

    expect(result).toBe('restored');
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('returns needs_gesture when handle exists but permission is prompt', async () => {
    const { deps } = createDeps();
    const controller = new SourceController(deps);
    const handle = {
      kind: 'file',
      name: 'data.tar.gz',
      queryPermission: vi.fn().mockResolvedValue('prompt'),
    } as unknown as FileSystemFileHandle;
    vi.mocked(handleStore.getHandle).mockResolvedValue(handle);

    const parsed = parseSourceUrl('file://data.tar.gz');
    const result = await controller.tryRestoreFromUrl(parsed, { allowRequest: false });

    expect(result).toBe('needs_gesture');
    expect(deps.initialize).not.toHaveBeenCalled();
  });
});

describe('SourceController history / popstate', () => {
  let locationState: { search: string; pathname: string };
  let popstateListeners: Array<() => void>;

  beforeEach(() => {
    locationState = { search: '', pathname: '/lerobot' };
    popstateListeners = [];
    vi.stubGlobal('window', {
      location: locationState,
      history: {
        pushState: vi.fn((_state: unknown, _title: string, url?: string) => {
          if (typeof url === 'string') {
            const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
            locationState.search = q;
            locationState.pathname = url.split('?')[0] || '/lerobot';
          }
        }),
        replaceState: vi.fn((_state: unknown, _title: string, url?: string) => {
          if (typeof url === 'string') {
            const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
            locationState.search = q;
            locationState.pathname = url.split('?')[0] || '/lerobot';
          }
        }),
      },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'popstate') popstateListeners.push(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'popstate') {
          popstateListeners = popstateListeners.filter((l) => l !== listener);
        }
      }),
      showDirectoryPicker: vi.fn(),
      showOpenFilePicker: vi.fn(),
    });
    vi.mocked(handleStore.putHandle).mockResolvedValue(true);
    vi.mocked(fsPermissions.supportsHandlePersistence).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('resets to welcome when browser back clears the url param', async () => {
    const { deps } = createDeps();
    const openFromUrl = vi.spyOn(SourceController.prototype, 'openFromUrl');
    const controller = new SourceController(deps);
    const detach = controller.attachPopstateListener();

    // Simulate a prior push that the controller itself performed
    locationState.search = '?url=https://example.com/a.zip';
    // Sync internal lastHandledUrl by opening (mocked initialize)
    await controller.openRemoteArchive('https://example.com/a.zip', { historyMode: 'push' });
    openFromUrl.mockClear();

    // User hits back → empty search
    locationState.search = '';
    for (const listener of popstateListeners) listener();

    expect(openFromUrl).toHaveBeenCalledWith('', 'replace');
    await vi.waitFor(() => {
      expect(deps.reset).toHaveBeenCalled();
    });

    detach();
    openFromUrl.mockRestore();
  });

  it('keeps lastHandledUrl in sync after push so back is not ignored', async () => {
    const { deps } = createDeps();
    const controller = new SourceController(deps);
    const detach = controller.attachPopstateListener();

    await controller.openRemoteArchive('https://example.com/a.zip', { historyMode: 'push' });
    expect(locationState.search).toContain('url=');

    const openSpy = vi.spyOn(controller, 'openFromUrl');
    locationState.search = '';
    for (const listener of popstateListeners) listener();
    expect(openSpy).toHaveBeenCalledWith('', 'replace');

    detach();
    openSpy.mockRestore();
  });
});
