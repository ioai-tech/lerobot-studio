import { describe, expect, it } from 'vitest';
import { resolveDroppedItem, toDirectoryFiles } from '../src/platform/utils/droppedEntries';

interface MockEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: MockEntry[]) => void) => void;
  };
}

function fileEntry(name: string, content: string): MockEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => success(new File([content], name)),
  };
}

function directoryEntry(name: string, batches: MockEntry[][]): MockEntry {
  let batchIndex = 0;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (success) => success(batches[batchIndex++] || []),
    }),
  };
}

function dropWithEntry(entry: MockEntry) {
  return {
    items: [
      {
        kind: 'file',
        webkitGetAsEntry: () => entry,
        getAsFile: () => null,
      },
    ],
    files: [],
  } as unknown as DataTransfer;
}

describe('dropped directory entries', () => {
  it('recursively reads directory entries and every reader batch', async () => {
    const nested = directoryEntry('meta', [[fileEntry('info.json', '{}')], []]);
    const root = directoryEntry('dataset', [[nested], [fileEntry('data.parquet', 'rows')], []]);

    await expect(resolveDroppedItem(dropWithEntry(root))).resolves.toMatchObject({
      kind: 'directory-files',
      files: [{ path: 'dataset/meta/info.json' }, { path: 'dataset/data.parquet' }],
    });
  });

  it('uses relative paths from flattened dropped files', async () => {
    const file = new File(['{}'], 'info.json');
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'dataset/meta/info.json',
    });
    const dataTransfer = {
      items: [{ kind: 'file', getAsFile: () => file }],
      files: [file],
    } as unknown as DataTransfer;

    await expect(resolveDroppedItem(dataTransfer)).resolves.toMatchObject({
      kind: 'directory-files',
      files: [{ file, path: 'dataset/meta/info.json' }],
    });
  });

  it('returns a recoverable directory result for a browser directory placeholder', async () => {
    const folder = new File([], 'dataset');
    const dataTransfer = {
      items: [{ kind: 'file', getAsFile: () => folder }],
      files: [folder],
    } as unknown as DataTransfer;

    await expect(resolveDroppedItem(dataTransfer)).resolves.toEqual({
      kind: 'unresolved-directory',
      name: 'dataset',
    });
  });

  it('keeps a supported archive as a file', async () => {
    const archive = new File([], 'dataset.zip');
    const dataTransfer = {
      items: [{ kind: 'file', getAsFile: () => archive }],
      files: [archive],
    } as unknown as DataTransfer;

    await expect(resolveDroppedItem(dataTransfer)).resolves.toEqual({
      kind: 'file',
      file: archive,
    });
  });

  it('creates explicit directory entries from picker files', () => {
    const file = new File(['{}'], 'info.json');
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'dataset/meta/info.json',
    });

    expect(toDirectoryFiles([file])).toEqual([{ file, path: 'dataset/meta/info.json' }]);
  });
});
