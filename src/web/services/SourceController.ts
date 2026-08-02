import { DirectoryDataSource, FileListDirectoryDataSource, type ProgressInfo } from '@/platform';
import type { LoadingPhase, HistoryItem, HistoryItemKind, ParsedSourceUrl } from '@';
import {
  buildFileUrl,
  buildFolderUrl,
  buildHistoryIdsFromParsed,
  buildHistoryItemFromParsed,
  buildSampleUrl,
  canonicalizeLocalSourceUrl,
  getUrlParamFromLocation,
  parseSourceUrl,
  setUrlParamInLocation,
} from '../utils/sourceUrl';
import type { SampleDataset } from '@/platform';
import { getArchiveUrl } from '@/platform';
import { getSampleByIdAsync } from '@/platform';
import {
  createArchiveDataSourceFromFile,
  createArchiveDataSourceFromUrl,
  getArchiveBasename,
  getArchiveKindFromUrl,
} from '@/platform';
import { preflightRemoteArchive, translateRemotePreflightFailure } from '@/platform';
import type { DataSource } from '@/platform';
import { deleteHandle, getHandle, putHandle } from '@/platform';
import { supportsHandlePersistence, verifyPermission } from '@/platform';

type TFunction = (
  key: string,
  defaultMessageOrValues?: string | Record<string, unknown>,
  valuesArg?: Record<string, unknown>,
) => string;

export interface SourceControllerDeps {
  // core loader lifecycle
  initialize: (dataSource: DataSource) => Promise<void>;
  reset: () => Promise<void>;

  // loading UI
  upsertTask: (task: {
    id: string;
    title?: string;
    phase: LoadingPhase;
    loaded?: number;
    total?: number;
    message?: string;
    error?: string;
  }) => void;
  completeTask: (id: string) => void;
  failTask: (id: string, error: string) => void;
  clearTasks: () => void;

  // history
  addHistoryItem: (item: {
    id: string;
    kind: HistoryItemKind;
    label: string;
    payload: { url?: string; path?: string; sampleId?: string };
    hasHandle?: boolean;
  }) => void;
  clearHistoryHandleFlag?: (id: string) => void;

  // UI state bridges
  setDatasetLabel: (label: string | undefined) => void;
  setWelcomeRequest: (req: ParsedSourceUrl | null) => void;

  // i18n
  t: TFunction;
  showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export class SourceController {
  private deps: SourceControllerDeps;
  /** Last URL this controller applied (push/replace/popstate). */
  private lastHandledUrl = '';
  /** Serializes open operations so rapid A→B switches discard stale work. */
  private openGeneration = 0;

  constructor(deps: SourceControllerDeps) {
    this.deps = deps;
    this.lastHandledUrl = getUrlParamFromLocation() || '';
  }

  private syncUrl(rawUrl: string | null, mode: 'push' | 'replace' = 'replace') {
    setUrlParamInLocation(rawUrl, mode);
    this.lastHandledUrl = rawUrl || '';
  }

  private beginOpen(): number {
    this.openGeneration += 1;
    return this.openGeneration;
  }

  private isOpenCurrent(generation: number): boolean {
    return generation === this.openGeneration;
  }

  private createProgress(taskId: string, title: string) {
    return (info: ProgressInfo) => {
      this.deps.upsertTask({
        id: taskId,
        title,
        phase: info.phase,
        loaded: info.loaded,
        total: info.total,
        message: info.message,
      });
    };
  }

  private async initializeSource(source: DataSource) {
    await this.deps.initialize(source);
  }

  private async resetToWelcome(requested: ParsedSourceUrl | null) {
    await this.deps.reset();
    this.deps.clearTasks();
    this.deps.setDatasetLabel(undefined);
    this.deps.setWelcomeRequest(requested);
  }

  async openDirectory() {
    const taskId = 'open-dir';
    try {
      if (typeof window.showDirectoryPicker === 'function') {
        const handle = await window.showDirectoryPicker();
        await this.openDirectoryHandle(handle);
      } else {
        const files = await this.pickDirectoryFilesWithInput();
        await this.openDirectoryFiles(files);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const msg = (e as Error).message;
        this.deps.failTask(taskId, msg);
        this.deps.showToast?.(msg, 'error');
        console.error('Failed to select directory', e);
      }
    }
  }

  private pickDirectoryFilesWithInput(): Promise<FileList> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.style.display = 'none';
      input.setAttribute('webkitdirectory', '');

      const cleanup = () => {
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }
      };

      input.onchange = () => {
        const files = input.files;
        cleanup();
        if (files && files.length > 0) {
          resolve(files);
          return;
        }
        reject(new DOMException('Directory selection cancelled', 'AbortError'));
      };

      input.oncancel = () => {
        cleanup();
        reject(new DOMException('Directory selection cancelled', 'AbortError'));
      };

      document.body.appendChild(input);
      input.click();

      setTimeout(cleanup, 60000);
    });
  }

  private getDirectoryLabelFromFiles(files: FileList | File[]): string {
    const firstFile = Array.from(files)[0];
    const relativePath = firstFile?.webkitRelativePath || '';
    const label = relativePath.split('/')[0];
    return label || firstFile?.name || 'directory';
  }

  async openDirectoryFiles(files: FileList | File[]) {
    const taskId = 'open-dir';
    const generation = this.beginOpen();
    try {
      const label = this.getDirectoryLabelFromFiles(files);
      this.deps.setDatasetLabel(label);
      this.deps.upsertTask({ id: taskId, title: label, phase: 'read', loaded: 0, total: 1 });

      const source = new FileListDirectoryDataSource(files);
      await this.initializeSource(source);
      if (!this.isOpenCurrent(generation)) return;
      this.deps.completeTask(taskId);

      const shareUrl = buildFolderUrl(label);
      this.syncUrl(shareUrl, 'push');
      this.deps.addHistoryItem({
        id: `directory:${shareUrl}`,
        kind: 'directory',
        label,
        payload: { path: label, url: shareUrl },
      });
    } catch (e) {
      if (!this.isOpenCurrent(generation)) return;
      const msg = (e as Error).message;
      this.deps.failTask(taskId, msg);
      this.deps.showToast?.(msg, 'error');
      console.error('Failed to initialize selected directory files', e);
    }
  }

  async openDirectoryHandle(handle: FileSystemDirectoryHandle) {
    const taskId = 'open-dir';
    const generation = this.beginOpen();
    try {
      // 顶部展示名优先使用“用户可理解”的来源名称（目录名）
      const label = handle.name;
      this.deps.setDatasetLabel(label);
      this.deps.upsertTask({ id: taskId, title: label, phase: 'read', loaded: 0, total: 1 });
      await this.initializeSource(new DirectoryDataSource(handle));
      if (!this.isOpenCurrent(generation)) return;
      this.deps.completeTask(taskId);

      const shareUrl = buildFolderUrl(handle.name);
      this.syncUrl(shareUrl, 'push');
      const historyId = `directory:${shareUrl}`;
      const hasHandle = await this.persistHandle(historyId, handle);
      this.deps.addHistoryItem({
        id: historyId,
        kind: 'directory',
        label: handle.name,
        payload: { path: handle.name, url: shareUrl },
        ...(hasHandle ? { hasHandle: true } : {}),
      });
    } catch (e) {
      if (!this.isOpenCurrent(generation)) return;
      const msg = (e as Error).message;
      this.deps.failTask(taskId, msg);
      this.deps.showToast?.(msg, 'error');
      console.error('Failed to initialize directory handle', e);
    }
  }

  private async persistHandle(historyId: string, handle: FileSystemHandle): Promise<boolean> {
    if (!supportsHandlePersistence()) return false;
    return putHandle(historyId, handle);
  }

  private async openLocalArchiveWithPicker() {
    const taskId = 'open-local-archive';
    try {
      if (typeof window.showOpenFilePicker === 'function') {
        const [fileHandle] = await window.showOpenFilePicker({
          types: [
            {
              description: 'LeRobot Archive',
              accept: {
                'application/zip': ['.zip'],
                'application/x-tar': ['.tar'],
                'application/x-gzip': ['.tar.gz', '.tgz'],
              },
            },
          ],
          excludeAcceptAllOption: false,
          multiple: false,
        });
        const file = await fileHandle.getFile();
        await this.openFile(file, fileHandle);
      } else {
        // Fallback for Firefox using manual input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,.tar,.tar.gz,.tgz';
        input.style.display = 'none';

        input.onchange = async (e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files && files.length > 0) {
            await this.openFile(files[0]);
          }
        };

        document.body.appendChild(input);
        input.click();

        // Cleanup
        setTimeout(() => {
          if (document.body.contains(input)) {
            document.body.removeChild(input);
          }
        }, 60000);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const msg = (e as Error).message;
        this.deps.failTask(taskId, msg);
        this.deps.showToast?.(msg, 'error');
        console.error('Failed to select archive', e);
      }
    }
  }

  async openLocalArchive() {
    await this.openLocalArchiveWithPicker();
  }

  async openFile(file: File, sourceHandle?: FileSystemFileHandle) {
    const taskId = 'open-local-archive';
    const generation = this.beginOpen();
    try {
      this.deps.setDatasetLabel(file.name);

      const source = createArchiveDataSourceFromFile(file, this.createProgress(taskId, file.name));
      // 本地文件不易精确进度，total 置空避免 0% 误导
      this.deps.upsertTask({
        id: taskId,
        title: file.name,
        phase: 'download',
        loaded: 0,
        total: undefined,
      });
      await this.initializeSource(source);
      if (!this.isOpenCurrent(generation)) return;
      this.deps.completeTask(taskId);

      const shareUrl = buildFileUrl(file.name);
      this.syncUrl(shareUrl, 'push');
      const historyId = `localArchive:${shareUrl}`;
      const hasHandle = sourceHandle ? await this.persistHandle(historyId, sourceHandle) : false;
      this.deps.addHistoryItem({
        id: historyId,
        kind: 'localArchive',
        label: file.name,
        payload: { path: file.name, url: shareUrl },
        ...(hasHandle ? { hasHandle: true } : {}),
      });
    } catch (e) {
      if (!this.isOpenCurrent(generation)) return;
      const msg = (e as Error).message;
      this.deps.failTask(taskId, msg);
      this.deps.showToast?.(msg, 'error');
      console.error('Failed to initialize file', e);
    }
  }

  async openRemoteArchive(
    httpUrl: string,
    options?: {
      historyMode?: 'push' | 'replace';
      shareUrl?: string;
      label?: string;
      historyKind?: HistoryItemKind;
      sampleId?: string;
    },
  ) {
    const url = (httpUrl || '').trim();
    if (!url) return;

    const taskId = 'open-remote-archive';
    const generation = this.beginOpen();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const msg = this.tDefault('validation.invalidUrl');
      this.deps.upsertTask({ id: taskId, title: url, phase: 'error', error: msg });
      this.deps.failTask(taskId, msg);
      this.deps.showToast?.(msg, 'warning');
      return;
    }

    const base = getArchiveBasename(url);
    this.deps.setDatasetLabel(options?.label || base || url);

    try {
      this.deps.upsertTask({
        id: taskId,
        title: url,
        phase: 'download',
        loaded: 0,
        total: 0,
        message: this.tDefault('dialogs.remoteArchive.preflight'),
      });
      const pre = await preflightRemoteArchive(url);
      if (!this.isOpenCurrent(generation)) return;
      if (!pre.ok) {
        const friendly = translateRemotePreflightFailure(this.deps.t, pre.failure);
        this.deps.upsertTask({
          id: taskId,
          title: url,
          phase: 'error',
          error: friendly,
          message: undefined,
        });
        this.deps.failTask(taskId, friendly);
        this.deps.showToast?.(friendly, 'error');
        return;
      }
      const kind = getArchiveKindFromUrl(url) || pre.kind;
      if (!kind) {
        const msg = this.tDefault('validation.unsupportedFormat');
        this.deps.upsertTask({ id: taskId, title: url, phase: 'error', error: msg });
        this.deps.failTask(taskId, msg);
        this.deps.showToast?.(msg, 'warning');
        return;
      }

      const source = createArchiveDataSourceFromUrl(url, this.createProgress(taskId, url), kind, {
        accessMode: pre.accessMode,
      });
      this.deps.upsertTask({ id: taskId, title: url, phase: 'download', loaded: 0, total: 0 });
      await this.initializeSource(source);
      if (!this.isOpenCurrent(generation)) return;
      this.deps.completeTask(taskId);

      const canonical = options?.shareUrl || url;
      this.syncUrl(canonical, options?.historyMode || 'replace');

      const historyKind: HistoryItemKind = options?.historyKind || 'remoteArchive';
      const historyId =
        historyKind === 'sample' && options?.sampleId
          ? `sample:${options.sampleId}`
          : historyKind === 'remoteArchive'
            ? `remoteArchive:${canonical}`
            : `remote:${canonical}`;

      this.deps.addHistoryItem({
        id: historyId,
        kind: historyKind,
        label: options?.label || base || url,
        payload: {
          url: canonical,
          ...(historyKind === 'sample' && options?.sampleId ? { sampleId: options.sampleId } : {}),
        },
      });
    } catch (e) {
      if (!this.isOpenCurrent(generation)) return;
      const msg = (e as Error).message;
      this.deps.failTask(taskId, msg);
      this.deps.showToast?.(msg, 'error');
      console.error('Failed to load remote archive', e);
    }
  }

  async openSample(sample: SampleDataset) {
    const shareUrl = buildSampleUrl(sample.id);
    const archiveUrl = getArchiveUrl(sample);
    await this.openRemoteArchive(archiveUrl, {
      shareUrl,
      label: sample.title || sample.name,
      historyMode: 'push',
      historyKind: 'sample',
      sampleId: sample.id,
    });
  }

  async openFromUrl(rawUrl: string | null, historyMode: 'push' | 'replace' = 'replace') {
    const parsed = parseSourceUrl(rawUrl || '');
    if (parsed.kind === 'remoteArchive') {
      this.deps.setWelcomeRequest(null);
      await this.openRemoteArchive(parsed.raw, { historyMode });
      return;
    }

    if (parsed.kind === 'sample') {
      const sample = parsed.sampleId ? await getSampleByIdAsync(parsed.sampleId) : undefined;
      if (!sample) {
        this.beginOpen();
        await this.resetToWelcome(parsed);
        if (parsed.raw) this.syncUrl(parsed.raw, historyMode);
        return;
      }
      this.deps.setWelcomeRequest(null);
      await this.openRemoteArchive(getArchiveUrl(sample), {
        shareUrl: buildSampleUrl(sample.id),
        label: sample.name,
        historyMode,
        historyKind: 'sample',
        sampleId: sample.id,
      });
      return;
    }

    if (parsed.kind === 'directory' || parsed.kind === 'localArchive') {
      const restoreResult = await this.tryRestoreFromUrl(parsed, { allowRequest: false });
      const canonicalUrl = canonicalizeLocalSourceUrl(parsed);
      if (restoreResult === 'restored') {
        this.deps.setWelcomeRequest(null);
        if (canonicalUrl) {
          this.syncUrl(canonicalUrl, historyMode);
        }
        return;
      }

      this.beginOpen();
      await this.resetToWelcome({
        ...parsed,
        raw: canonicalUrl,
        restorable: restoreResult === 'needs_gesture',
      });
      if (canonicalUrl) {
        this.syncUrl(canonicalUrl, historyMode);
      } else {
        this.syncUrl(null, historyMode);
      }
      return;
    }

    this.beginOpen();
    await this.resetToWelcome(null);
    this.syncUrl(null, historyMode);
  }

  async restoreFromUrl(parsed: ParsedSourceUrl) {
    const restoreResult = await this.tryRestoreFromUrl(parsed, { allowRequest: true });
    if (restoreResult === 'restored') {
      this.deps.setWelcomeRequest(null);
      return;
    }
    const historyIds = buildHistoryIdsFromParsed(parsed);
    const item = historyIds.length > 0 ? buildHistoryItemFromParsed(parsed, historyIds[0]) : null;
    if (item) {
      await this.fallbackToPicker(item);
    }
  }

  private async resolveStoredHandle(
    parsed: ParsedSourceUrl,
  ): Promise<{ handle: FileSystemHandle; historyId: string } | null> {
    if (!supportsHandlePersistence()) return null;
    for (const historyId of buildHistoryIdsFromParsed(parsed)) {
      const handle = await getHandle(historyId);
      if (handle) return { handle, historyId };
    }
    return null;
  }

  private async openStoredHandle(parsed: ParsedSourceUrl, handle: FileSystemHandle): Promise<void> {
    if (parsed.kind === 'directory' && handle.kind === 'directory') {
      await this.openDirectoryHandle(handle as FileSystemDirectoryHandle);
      return;
    }
    if (parsed.kind === 'localArchive' && handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      await this.openFile(file, handle as FileSystemFileHandle);
    }
  }

  async tryRestoreFromUrl(
    parsed: ParsedSourceUrl,
    options: { allowRequest: boolean },
  ): Promise<'restored' | 'needs_gesture' | 'unavailable'> {
    const resolved = await this.resolveStoredHandle(parsed);
    if (!resolved) return 'unavailable';

    const { handle } = resolved;

    try {
      if (typeof handle.queryPermission === 'function') {
        const status = await handle.queryPermission({});
        if (status === 'granted') {
          await this.openStoredHandle(parsed, handle);
          return 'restored';
        }
      }

      if (!options.allowRequest) {
        return 'needs_gesture';
      }

      const granted = await verifyPermission(handle, { mode: 'read' });
      if (granted) {
        await this.openStoredHandle(parsed, handle);
        return 'restored';
      }
      return 'needs_gesture';
    } catch (e) {
      const err = e as Error;
      if (err.name === 'NotFoundError') {
        for (const historyId of buildHistoryIdsFromParsed(parsed)) {
          await deleteHandle(historyId);
        }
        this.deps.clearHistoryHandleFlag?.(buildHistoryIdsFromParsed(parsed)[0] ?? '');
      } else if (err.name !== 'AbortError') {
        this.deps.showToast?.(err.message, 'error');
      }
      return 'unavailable';
    }
  }

  async restoreFromHistory(item: HistoryItem) {
    if (!item.hasHandle || !supportsHandlePersistence()) {
      return this.fallbackToPicker(item);
    }

    let handle = await getHandle(item.id);
    if (!handle && item.payload.url) {
      const parsed = parseSourceUrl(item.payload.url);
      const resolved = await this.resolveStoredHandle(parsed);
      handle = resolved?.handle ?? null;
      if (handle) {
        const restoreResult = await this.tryRestoreFromUrl(parsed, { allowRequest: true });
        if (restoreResult === 'restored') return;
        return this.fallbackToPicker(item);
      }
    }
    if (!handle) {
      this.deps.clearHistoryHandleFlag?.(item.id);
      this.deps.showToast?.(this.tDefault('source.restoreHandleMissing'), 'warning');
      return this.fallbackToPicker(item);
    }

    try {
      const granted = await verifyPermission(handle, { mode: 'read' });
      if (!granted) {
        this.deps.showToast?.(this.tDefault('source.restorePermissionDenied'), 'warning');
        return this.fallbackToPicker(item);
      }

      if (item.kind === 'directory' && handle.kind === 'directory') {
        await this.openDirectoryHandle(handle as FileSystemDirectoryHandle);
        return;
      }

      if (item.kind === 'localArchive' && handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        await this.openFile(file, handle as FileSystemFileHandle);
        return;
      }

      await deleteHandle(item.id);
      this.deps.showToast?.(this.tDefault('source.restoreHandleMismatch'), 'warning');
      return this.fallbackToPicker(item);
    } catch (e) {
      const err = e as Error;
      if (err.name === 'NotFoundError') {
        await deleteHandle(item.id);
        this.deps.showToast?.(this.tDefault('source.restoreHandleNotFound'), 'warning');
      } else if (err.name !== 'AbortError') {
        this.deps.showToast?.(err.message, 'error');
      }
      return this.fallbackToPicker(item);
    }
  }

  private async fallbackToPicker(item: HistoryItem) {
    if (item.kind === 'directory') {
      await this.openDirectory();
    } else if (item.kind === 'localArchive') {
      await this.openLocalArchive();
    } else if (item.kind === 'remoteArchive' && item.payload.url) {
      await this.openRemoteArchive(item.payload.url);
    } else if (item.kind === 'sample') {
      const sample = item.payload.sampleId
        ? await getSampleByIdAsync(item.payload.sampleId)
        : undefined;
      if (sample) await this.openSample(sample);
    }
  }

  attachPopstateListener() {
    const onPop = () => {
      const next = getUrlParamFromLocation() || '';
      if (next === this.lastHandledUrl) return;
      this.lastHandledUrl = next;
      void this.openFromUrl(next, 'replace');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }

  private tDefault(key: string) {
    return this.deps.t(key);
  }
}
