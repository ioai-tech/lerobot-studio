import { canUseFileSystemAccess } from './fsPermissions';

export interface DirectoryFile {
  file: File;
  path: string;
}

interface FileSystemEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file(successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void): void;
}

interface FileSystemDirectoryReaderLike {
  readEntries(
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void,
  ): void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader(): FileSystemDirectoryReaderLike;
}

interface DataTransferItemWithEntries {
  getAsEntry?: () => FileSystemEntryLike | null;
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
}

interface DataTransferItemWithHandle extends DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

export type DroppedItem =
  | { kind: 'directory-handle'; handle: FileSystemDirectoryHandle }
  | { kind: 'file-handle'; file: File; handle: FileSystemFileHandle }
  | { kind: 'directory-files'; files: DirectoryFile[] }
  | { kind: 'file'; file: File }
  | { kind: 'unresolved-directory'; name: string }
  | { kind: 'none' };

export function isDirectoryFile(value: unknown): value is DirectoryFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'file' in value &&
    'path' in value &&
    (value as DirectoryFile).file instanceof File &&
    typeof (value as DirectoryFile).path === 'string'
  );
}

export function toDirectoryFiles(files: FileList | File[]): DirectoryFile[] {
  return Array.from(files)
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
    .filter(({ path }) => Boolean(path));
}

export async function resolveDroppedItem(dataTransfer: DataTransfer): Promise<DroppedItem> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) return { kind: 'none' };

  const item = Array.from(items).find((candidate) => candidate.kind === 'file');
  if (!item) return { kind: 'none' };

  const handleItem = item as DataTransferItemWithHandle;
  if (canUseFileSystemAccess() && handleItem.getAsFileSystemHandle) {
    try {
      const handle = await handleItem.getAsFileSystemHandle();
      if (handle?.kind === 'directory') {
        return { kind: 'directory-handle', handle: handle as FileSystemDirectoryHandle };
      }
      if (handle?.kind === 'file') {
        const fileHandle = handle as FileSystemFileHandle;
        return { kind: 'file-handle', file: await fileHandle.getFile(), handle: fileHandle };
      }
    } catch (error) {
      console.warn(
        'Failed to get a dropped file system handle; trying legacy directory entries.',
        error,
      );
    }
  }

  const entryItem = item as unknown as DataTransferItemWithEntries;
  const entry = entryItem.getAsEntry?.() ?? entryItem.webkitGetAsEntry?.();
  if (entry?.isDirectory) {
    return { kind: 'directory-files', files: await readDirectoryEntry(entry) };
  }
  if (entry?.isFile) {
    return { kind: 'file', file: await readFileEntry(entry) };
  }

  const files = dataTransfer.files;
  const directoryFiles = toDirectoryFiles(files);
  if (directoryFiles.some(({ file }) => file.webkitRelativePath?.includes('/'))) {
    return { kind: 'directory-files', files: directoryFiles };
  }

  const file = item.getAsFile();
  if (!file) return { kind: 'none' };
  if (files.length === 1 && file.size === 0 && !hasArchiveExtension(file.name)) {
    return { kind: 'unresolved-directory', name: file.name };
  }
  return { kind: 'file', file };
}

function hasArchiveExtension(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    lowerName.endsWith('.zip') ||
    lowerName.endsWith('.tar') ||
    lowerName.endsWith('.tar.gz') ||
    lowerName.endsWith('.tgz')
  );
}

async function readDirectoryEntry(entry: FileSystemEntryLike): Promise<DirectoryFile[]> {
  const directory = entry as FileSystemDirectoryEntryLike;
  const reader = directory.createReader();
  const files: DirectoryFile[] = [];
  let entries = await readEntryBatch(reader);

  while (entries.length > 0) {
    for (const child of entries) {
      files.push(...(await readEntry(child, directory.name)));
    }
    entries = await readEntryBatch(reader);
  }

  return files;
}

async function readEntry(entry: FileSystemEntryLike, parentPath: string): Promise<DirectoryFile[]> {
  if (entry.isFile) {
    return [{ file: await readFileEntry(entry), path: `${parentPath}/${entry.name}` }];
  }

  if (!entry.isDirectory) return [];
  const directory = entry as FileSystemDirectoryEntryLike;
  const reader = directory.createReader();
  const files: DirectoryFile[] = [];
  const directoryPath = `${parentPath}/${directory.name}`;
  let entries = await readEntryBatch(reader);

  while (entries.length > 0) {
    for (const child of entries) {
      files.push(...(await readEntry(child, directoryPath)));
    }
    entries = await readEntryBatch(reader);
  }

  return files;
}

function readEntryBatch(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function readFileEntry(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => (entry as FileSystemFileEntryLike).file(resolve, reject));
}
