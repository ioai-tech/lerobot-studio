import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Runs inside the (mocked) worker before a ranged decode, which then reads one byte the plan did not prefetch. */
const decoder = vi.hoisted(() => ({ beforeRead: null as null | (() => void) }));

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const parquet = await import('./helpers/parquet');
  return {
    createParquetWorker: () => ({
      readParquet: async (buffer: ArrayBuffer, columns?: string[]) =>
        parquet.readParquetToIPC(new Uint8Array(buffer), columns),
      readNumericColumns: async (buffer: ArrayBuffer, columns: string[], s: number, e: number) =>
        parquet.readNumericColumns(new Uint8Array(buffer), columns, s, e),
      readFeatureData: async (buffer: ArrayBuffer, columns: string[], s: number, e: number) =>
        parquet.readFeatureData(new Uint8Array(buffer), columns, s, e),
      readNumericColumnsRanged: async (
        ...args: Parameters<typeof parquet.readNumericColumnsRanged>
      ) => {
        if (decoder.beforeRead) {
          decoder.beforeRead();
          // A decoder read of bytes the plan did not prefetch (the first gap).
          const parts = [...args[0].parts].sort((a, b) => a.start - b.start);
          let cursor = 4;
          for (const part of parts) {
            if (part.start > cursor) break;
            cursor = Math.max(cursor, part.start + part.bytes.byteLength);
          }
          if (cursor < args[0].size) await args[1](cursor, cursor + 1);
        }
        return parquet.readNumericColumnsRanged(...args);
      },
      readFeatureDataRanged: parquet.readFeatureDataRanged,
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import type { ByteRangeResult } from '@/core';
import { LeRobotDataLoader } from '@/platform';
import { RemoteSourceError } from '../src/platform/datasource/signedUrls';
import { LocalFsDataSource } from './helpers/localFsDataSource';
import { writeParquetBytes } from './helpers/writeParquet';

const here = path.dirname(fileURLToPath(import.meta.url));
const V3 = path.join(here, 'fixtures/datasets/lerobotv3');
const DATA = 'data/chunk-000/file-000.parquet';

/** Local files with Range reads (or a server that ignores them). */
class RangeFsSource extends LocalFsDataSource {
  readonly byteReads: string[] = [];
  readonly rangeReads: Array<{ path: string; start: number; end: number }> = [];
  constructor(
    root: string,
    private readonly mode: 'range' | 'ignore' | 'no-size' | 'encrypted' = 'range',
  ) {
    super(root);
  }
  override async readBytes(relativePath: string) {
    this.byteReads.push(relativePath);
    return super.readBytes(relativePath);
  }
  async readRange(relativePath: string, start: number, end?: number): Promise<ByteRangeResult> {
    if (this.mode === 'no-size') {
      throw new RemoteSourceError('RANGE_SIZE_UNKNOWN', relativePath, 'no size');
    }
    const bytes = await super.readBytes(relativePath);
    if (this.mode === 'ignore') {
      this.rangeReads.push({ path: relativePath, start: 0, end: bytes.length });
      return { bytes, start: 0, size: bytes.length };
    }
    const from = start < 0 ? Math.max(0, bytes.length + start) : Math.min(start, bytes.length);
    const to = start < 0 || end === undefined ? bytes.length : Math.min(end, bytes.length);
    this.rangeReads.push({ path: relativePath, start: from, end: to });
    const slice = bytes.slice(from, to);
    if (this.mode === 'encrypted' && to === bytes.length) {
      // An encrypted footer ends in PARE: a per-file fallback.
      slice.set([0x50, 0x41, 0x52, 0x45], slice.length - 4);
    }
    return { bytes: slice, start: from, size: bytes.length };
  }
}

/** A copy of the v3 fixture whose data file is larger than the footer probe. */
async function largeDataset(): Promise<string> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lerobot-range-'));
  cpSync(V3, root, { recursive: true });
  const rows = 12_000;
  writeFileSync(
    path.join(root, DATA),
    await writeParquetBytes({
      'observation.state': Array.from({ length: rows }, (_, i) => i),
      action: Array.from({ length: rows }, (_, i) => -i),
      timestamp: Array.from({ length: rows }, (_, i) => i / 10),
      frame_index: Array.from({ length: rows }, (_, i) => BigInt(i)),
      episode_index: Array.from({ length: rows }, (_, i) => BigInt(i < 3 ? 0 : 1)),
      index: Array.from({ length: rows }, (_, i) => BigInt(i)),
      task_index: Array.from({ length: rows }, () => 0n),
    }),
  );
  return root;
}

async function open(source: LocalFsDataSource) {
  const loader = new LeRobotDataLoader(source);
  await loader.initialize();
  return loader;
}

afterEach(() => {
  vi.restoreAllMocks();
  decoder.beforeRead = null;
});

/** The v3 fixture whose data file is replaced by `versions[current]` (a changing object). */
class VersionedSource extends LocalFsDataSource {
  current = 0;
  footerReads = 0;
  constructor(
    private readonly versions: Uint8Array[],
    private readonly ranges = true,
  ) {
    super(V3);
    // Without ranges: the reference whole-file read.
    if (!ranges) Object.defineProperty(this, 'readRange', { value: undefined });
  }
  override async readBytes(relativePath: string) {
    if (relativePath === DATA) return this.versions[this.current]!;
    return super.readBytes(relativePath);
  }
  async readRange(relativePath: string, start: number, end?: number): Promise<ByteRangeResult> {
    const bytes = await this.readBytes(relativePath);
    const from = start < 0 ? Math.max(0, bytes.length + start) : Math.min(start, bytes.length);
    const to = start < 0 || end === undefined ? bytes.length : Math.min(end, bytes.length);
    if (relativePath === DATA && start < 0) this.footerReads += 1;
    return { bytes: bytes.slice(from, to), start: from, size: bytes.length };
  }
}

/** A data file for the fixture's episodes, larger than the footer probe. */
function dataFile(rows: number, offset: number): Promise<Uint8Array> {
  return writeParquetBytes({
    'observation.state': Array.from({ length: rows }, (_, i) => i + offset),
    action: Array.from({ length: rows }, (_, i) => -i - offset),
    timestamp: Array.from({ length: rows }, (_, i) => i / 10),
    frame_index: Array.from({ length: rows }, (_, i) => BigInt(i)),
    episode_index: Array.from({ length: rows }, (_, i) => BigInt(i < 3 ? 0 : 1)),
    index: Array.from({ length: rows }, (_, i) => BigInt(i)),
    task_index: Array.from({ length: rows }, () => 0n),
  });
}

/** Two versions of one data file (other values, other size). */
async function dataVersions(): Promise<Uint8Array[]> {
  return [await dataFile(12_000, 0), await dataFile(14_000, 1000)];
}

/** What a whole-file read of `version` gives. */
async function wholeRead(
  versions: Uint8Array[],
  version: number,
  episode: number,
  columns: string[],
) {
  const source = new VersionedSource(versions, false);
  source.current = version;
  return (await open(source)).loadAllNumericalData(episode, columns);
}

describe('LeRobotDataLoader range reads', () => {
  it('reads episode columns by range, equal to the whole-file read', async () => {
    const whole = await open(new LocalFsDataSource(V3));
    const source = new RangeFsSource(V3);
    const ranged = await open(source);
    const columns = ['timestamp', 'observation.state', 'action'];

    for (const episode of [0, 1]) {
      expect(await ranged.loadAllNumericalData(episode, columns)).toEqual(
        await whole.loadAllNumericalData(episode, columns),
      );
      expect(await ranged.loadFeatureData(episode, ['index', 'frame_index'])).toEqual(
        await whole.loadFeatureData(episode, ['index', 'frame_index']),
      );
    }
    // The data file is never downloaded whole.
    expect(source.byteReads).not.toContain(DATA);
    expect(source.rangeReads.some((read) => read.path === DATA)).toBe(true);
    expect(ranged.getRangeReadStatus()).toEqual({ mode: 'range', reason: null });
  });

  it('reports bytes in before decoding, so the next read can start', async () => {
    const loader = await open(new RangeFsSource(V3));
    const order: string[] = [];
    const result = loader
      .loadAllNumericalData(0, ['observation.state'], { onFetched: () => order.push('fetched') })
      .then(() => order.push('decoded'));
    await result;
    expect(order).toEqual(['fetched', 'decoded']);
  });

  it('reads the file whole, once, with a named warning when ranges are ignored', async () => {
    // A data file larger than the footer probe, so a whole-file answer shows.
    const root = await largeDataset();
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const whole = await open(new LocalFsDataSource(root));
      const source = new RangeFsSource(root, 'ignore');
      const loader = await open(source);
      const columns = ['timestamp', 'observation.state'];

      expect(await loader.loadAllNumericalData(0, columns)).toEqual(
        await whole.loadAllNumericalData(0, columns),
      );
      expect(await loader.loadAllNumericalData(1, columns)).toEqual(
        await whole.loadAllNumericalData(1, columns),
      );
      // The whole-file answer to the footer probe is the file: no second download.
      expect(source.rangeReads.filter((read) => read.path === DATA)).toHaveLength(1);
      expect(source.byteReads).not.toContain(DATA);
      expect(loader.getRangeReadStatus()).toEqual({
        mode: 'whole-file',
        reason: 'RANGE_UNSUPPORTED',
      });
      const named = warn.mock.calls.filter(([message]) =>
        String(message).includes('RANGE_UNSUPPORTED'),
      );
      expect(named).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads whole files with a named warning when the size is unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const whole = await open(new LocalFsDataSource(V3));
    const source = new RangeFsSource(V3, 'no-size');
    const loader = await open(source);
    expect(await loader.loadAllNumericalData(1, ['action'])).toEqual(
      await whole.loadAllNumericalData(1, ['action']),
    );
    expect(source.byteReads.filter((read) => read === DATA)).toHaveLength(1);
    expect(loader.getRangeReadStatus()).toEqual({
      mode: 'whole-file',
      reason: 'RANGE_SIZE_UNKNOWN',
    });
    expect(
      warn.mock.calls.some(([message]) => String(message).includes('RANGE_SIZE_UNKNOWN')),
    ).toBe(true);
  });

  it('warns once per fallback reason, however often it falls back', async () => {
    const root = await largeDataset();
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const whole = await open(new LocalFsDataSource(root));
      const source = new RangeFsSource(root, 'encrypted');
      const loader = await open(source);
      for (const episode of [0, 1, 0]) {
        await loader.releaseParsedCaches();
        expect(await loader.loadAllNumericalData(episode, ['action'])).toEqual(
          await whole.loadAllNumericalData(episode, ['action']),
        );
      }
      // Every read fell back (the file is refused; ranges stay on for other files)…
      expect(source.byteReads.filter((read) => read === DATA).length).toBeGreaterThan(1);
      expect(loader.getRangeReadStatus()).toEqual({ mode: 'range', reason: null });
      // …and the reason was reported once.
      const named = warn.mock.calls.filter(([message]) => String(message).includes('ENCRYPTED'));
      expect(named).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('plans a read again, once, when the decoder meets a new version of the file', async () => {
    const versions = await dataVersions();
    const source = new VersionedSource(versions);
    const loader = await open(source);
    let reads = 0;
    // The object is replaced between the plan and the decoder's first read.
    decoder.beforeRead = () => {
      if (reads++ === 0) source.current = 1;
    };
    const columns = ['timestamp', 'action'];
    expect(await loader.loadAllNumericalData(1, columns)).toEqual(
      await wholeRead(versions, 1, 1, columns),
    );
    expect(reads).toBe(2);
    expect(source.footerReads).toBe(2);
    expect(loader.getRangeReadStatus()).toEqual({ mode: 'range', reason: null });
  });

  it('reads the file whole, by name, when it changes again during the re-plan', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const versions = await dataVersions();
    const source = new VersionedSource(versions);
    const loader = await open(source);
    // Every decoder read sees the other version of the object.
    decoder.beforeRead = () => {
      source.current = 1 - source.current;
    };
    const columns = ['timestamp', 'action'];
    expect(await loader.loadAllNumericalData(1, columns)).toEqual(
      await wholeRead(versions, source.current, 1, columns),
    );
    expect(source.footerReads).toBe(2);
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes('FILE_CHANGED')),
    ).toHaveLength(1);
  });
});
