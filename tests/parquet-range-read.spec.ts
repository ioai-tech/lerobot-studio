import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Float64, Table, tableToIPC, vectorFromArray } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import type { ByteRangeResult, DataSource } from '@/core';
import {
  coalesceSpans,
  parseParquetFooter,
  ParquetFooterError,
  planParquetRead,
} from '../src/core/parquet/footer';
import { RemoteSourceError } from '../src/platform/datasource/signedUrls';
import {
  ParquetRangeReader,
  RangeFallback,
  type PreparedRangedRead,
} from '../src/platform/services/parquetRangeReader';
import { readRangedTable } from '../src/platform/workers/parquetDecode';
import { RangeNotFetchedError, SparseFile } from '../src/platform/workers/sparseFile';
import { getParquetWasmNode } from './helpers/parquetWasmNode';

const here = path.dirname(fileURLToPath(import.meta.url));
// Written by pyarrow 26.0.1 (write_page_index=False), like LeRobot's own data files:
// 600 rows in three row groups of 200 (episode_index 0, 1, 2), snappy;
// observation.state[i] = [i, i + 0.25, -i], action[i] = [i + 0.5, 0, 1].
const NO_PAGE_INDEX = new Uint8Array(
  readFileSync(path.join(here, 'fixtures/static/parquet/three-row-groups-no-page-index.parquet')),
);

/** parquet-wasm writes a page index: 1000 rows, groups of 300, small pages. */
async function pageIndexedFile(): Promise<Uint8Array> {
  const parquet = await getParquetWasmNode();
  const rows = 1000;
  const table = new Table({
    a: vectorFromArray(
      Array.from({ length: rows }, (_, i) => i),
      new Float64(),
    ),
    b: vectorFromArray(
      Array.from({ length: rows }, (_, i) => -i),
      new Float64(),
    ),
  });
  const props = new parquet.WriterPropertiesBuilder()
    .setMaxRowGroupSize(300)
    .setWriteBatchSize(20)
    .setDataPageSizeLimit(128)
    .build();
  return new Uint8Array(
    parquet.writeParquet(parquet.Table.fromIPCStream(tableToIPC(table, 'stream')), props),
  );
}

/** In-memory source with Blob.slice range semantics; records every read. */
class RangeSource implements DataSource {
  readonly reads: Array<{ path: string; start: number; end: number }> = [];
  ignoreRanges = false;
  failSize = false;
  constructor(private readonly files: Record<string, Uint8Array>) {}
  async exists(path: string) {
    return path in this.files;
  }
  async readText(path: string) {
    return new TextDecoder().decode(await this.readBytes(path));
  }
  async readBytes(path: string) {
    return this.files[path]!;
  }
  async getObjectUrl(): Promise<string> {
    throw new Error('not used');
  }
  clear() {}
  async readRange(path: string, start: number, end?: number): Promise<ByteRangeResult> {
    if (this.failSize) {
      throw new RemoteSourceError('RANGE_SIZE_UNKNOWN', path, 'no size');
    }
    const bytes = this.files[path]!;
    if (this.ignoreRanges) {
      this.reads.push({ path, start: 0, end: bytes.length });
      return { bytes, start: 0, size: bytes.length };
    }
    const from = start < 0 ? Math.max(0, bytes.length + start) : Math.min(start, bytes.length);
    const to = start < 0 || end === undefined ? bytes.length : Math.min(end, bytes.length);
    this.reads.push({ path, start: from, end: to });
    return { bytes: bytes.slice(from, to), start: from, size: bytes.length };
  }
  bytesRead(): number {
    return this.reads.reduce((sum, read) => sum + read.end - read.start, 0);
  }
}

async function decode(prepared: PreparedRangedRead) {
  const parquet = await getParquetWasmNode();
  const extra: Array<[number, number]> = [];
  const table = await readRangedTable(
    (file) => parquet.ParquetFile.fromFile(file),
    prepared.source,
    async (start, end) => {
      extra.push([start, end]);
      return prepared.fetchRange(start, end);
    },
    prepared.read,
  );
  return { table, extra };
}

describe('parquet footer', () => {
  it('reads row groups and column chunk ranges of a pyarrow file', () => {
    const footer = parseParquetFooter(NO_PAGE_INDEX, NO_PAGE_INDEX.length);
    expect(footer.numRows).toBe(600);
    expect(footer.rowGroups.map((group) => [group.firstRow, group.numRows])).toEqual([
      [0, 200],
      [200, 200],
      [400, 200],
    ]);
    const columns = footer.rowGroups[0]!.columns.map((chunk) => chunk.column);
    expect(columns).toEqual(['timestamp', 'observation.state', 'action', 'episode_index', 'index']);
    expect(footer.rowGroups[0]!.columns[1]!.path).toEqual(['observation.state', 'list', 'element']);
    const chunks = footer.rowGroups.flatMap((group) => group.columns);
    expect(chunks.every((chunk) => chunk.offsetIndex === undefined)).toBe(true);
    // Chunks tile the data region between the leading magic and the footer.
    const sorted = [...chunks].sort((a, b) => a.start - b.start);
    expect(sorted[0]!.start).toBe(4);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.start).toBe(sorted[i - 1]!.end);
    expect(sorted.at(-1)!.end).toBe(footer.metadataStart);
  });

  it('plans only the row groups of the requested rows and the selected columns', () => {
    const footer = parseParquetFooter(NO_PAGE_INDEX, NO_PAGE_INDEX.length);
    const plan = planParquetRead(footer, ['timestamp', 'observation.state', 'nope'], 250, 380);
    expect(plan.rowGroups).toEqual([1]);
    expect(plan.firstRow).toBe(200);
    expect(plan.rows).toBe(200);
    const group = footer.rowGroups[1]!;
    expect(plan.spans).toEqual(
      group.columns
        .filter((chunk) => chunk.column === 'timestamp' || chunk.column === 'observation.state')
        .map((chunk) => ({ start: chunk.start, end: chunk.end })),
    );
    expect(plan.indexSpans).toEqual([]);
    expect(plan.missingColumns).toEqual(['nope']);
    // endRow 0 reads to the end; an empty range selects nothing.
    expect(planParquetRead(footer, ['index'], 0, 0).rowGroups).toEqual([0, 1, 2]);
    expect(planParquetRead(footer, ['index'], 300, 300).rowGroups).toEqual([]);
  });

  it('merges nearby ranges only', () => {
    expect(
      coalesceSpans(
        [
          { start: 100, end: 200 },
          { start: 0, end: 50 },
          { start: 230, end: 300 },
        ],
        40,
      ),
    ).toEqual([
      { start: 0, end: 50 },
      { start: 100, end: 300 },
    ]);
  });

  it('names footers it cannot plan', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof ParquetFooterError ? error.code : String(error);
      }
      return 'no error';
    };
    const notParquet = new TextEncoder().encode('just some text, not a parquet file');
    expect(code(() => parseParquetFooter(notParquet, notParquet.length))).toBe('NOT_PARQUET');
    const encrypted = NO_PAGE_INDEX.slice();
    encrypted.set([0x50, 0x41, 0x52, 0x45], encrypted.length - 4);
    expect(code(() => parseParquetFooter(encrypted, encrypted.length))).toBe('ENCRYPTED');
    const tail = NO_PAGE_INDEX.subarray(NO_PAGE_INDEX.length - 64);
    expect(code(() => parseParquetFooter(tail, NO_PAGE_INDEX.length))).toBe('FOOTER_INCOMPLETE');
  });
});

describe('SparseFile', () => {
  const file = { size: 100, parts: [{ start: 10, bytes: new Uint8Array(20).fill(7) }] };

  it('serves fetched bytes and reports what is missing', async () => {
    const view = new SparseFile(file).slice(12, 18);
    expect(view.size).toBe(6);
    expect([...new Uint8Array(await view.arrayBuffer())]).toEqual([7, 7, 7, 7, 7, 7]);
    expect(new SparseFile(file).slice(0, 40).gaps()).toEqual([
      { start: 0, end: 10 },
      { start: 30, end: 40 },
    ]);
  });

  it('never returns zeros for bytes it does not have', async () => {
    await expect(new SparseFile(file).slice(5, 15).arrayBuffer()).rejects.toBeInstanceOf(
      RangeNotFetchedError,
    );
    const fetched: Array<[number, number]> = [];
    const lazy = new SparseFile({ ...file, parts: [...file.parts] }, async (start, end) => {
      fetched.push([start, end]);
      return new Uint8Array(end - start).fill(1);
    });
    expect([...new Uint8Array(await lazy.slice(5, 15).arrayBuffer())]).toEqual([
      1, 1, 1, 1, 1, 7, 7, 7, 7, 7,
    ]);
    expect(fetched).toEqual([[5, 10]]);
  });
});

describe('ParquetRangeReader', () => {
  it('fetches the footer and only the episode columns, then decodes them', async () => {
    const source = new RangeSource({ 'data.parquet': NO_PAGE_INDEX });
    // A small footer probe, so this 23 KB file is not read whole by it.
    const reader = new ParquetRangeReader(source, { footerProbeBytes: 1024 });
    const prepared = await reader.prepare(
      'data.parquet',
      ['timestamp', 'observation.state'],
      250,
      380,
    );
    expect(prepared.read).toEqual({
      columns: ['timestamp', 'observation.state'],
      rowGroups: [1],
      offset: 50,
      limit: 130,
    });
    const footer = parseParquetFooter(NO_PAGE_INDEX, NO_PAGE_INDEX.length);
    const [timestamp, state] = footer.rowGroups[1]!.columns;
    // The footer (probe, then the rest of the metadata), then the two
    // adjacent chunks of row group 1 in one request; nothing else.
    const dataReads = source.reads.filter((read) => read.start < footer.metadataStart);
    expect(dataReads).toEqual([{ path: 'data.parquet', start: timestamp!.start, end: state!.end }]);
    expect(source.bytesRead()).toBeLessThan(NO_PAGE_INDEX.length / 3);

    const { table, extra } = await decode(prepared);
    expect(extra).toEqual([]);
    expect(table.numRows).toBe(130);
    expect(Array.from(table.getChild('observation.state')!.get(0) as Iterable<number>)).toEqual([
      250, 250.25, -250,
    ]);
    expect(table.getChild('timestamp')!.get(129)).toBeCloseTo((379 % 200) / 30, 5);
    expect(table.getChild('action')).toBeNull();
  });

  it('reads a page-indexed file by row group and column, with its page index', async () => {
    const big = await pageIndexedFile();
    const footer = parseParquetFooter(big, big.length);
    const source = new RangeSource({ 'big.parquet': big });
    // No gap filling, so every fetched byte is one the read needs.
    const reader = new ParquetRangeReader(source, { footerProbeBytes: 1024, coalesceGapBytes: 0 });
    const prepared = await reader.prepare('big.parquet', ['a'], 330, 350);
    expect(prepared.read).toEqual({ columns: ['a'], rowGroups: [1], offset: 30, limit: 20 });
    const chunkA = footer.rowGroups[1]!.columns.find((chunk) => chunk.column === 'a')!;
    expect(chunkA.offsetIndex).toBeDefined();
    const { table, extra } = await decode(prepared);
    // Everything the decoder asked for was prefetched.
    expect(extra).toEqual([]);
    expect(table.numRows).toBe(20);
    expect(table.getChild('a')!.get(0)).toBe(330);
    expect(table.getChild('a')!.get(19)).toBe(349);
    // Data reads: chunk a of row group 1 and the page index; never column b,
    // never another row group.
    const dataReads = source.reads.filter((read) => read.start < footer.metadataStart);
    const fetched = new Set<number>();
    for (const read of dataReads) for (let i = read.start; i < read.end; i++) fetched.add(i);
    for (const group of footer.rowGroups) {
      for (const chunk of group.columns) {
        const wanted = chunk === chunkA;
        const inside = [...fetched].filter((i) => i >= chunk.start && i < chunk.end).length;
        expect(inside).toBe(wanted ? chunk.end - chunk.start : 0);
        if (chunk.offsetIndex) {
          expect(chunk.offsetIndex.start).toBeGreaterThanOrEqual(footer.pageIndex!.start);
          expect(chunk.offsetIndex.end).toBeLessThanOrEqual(footer.pageIndex!.end);
        }
      }
    }
  });

  it('reuses fetched bytes and shares reads in flight', async () => {
    const source = new RangeSource({ 'data.parquet': NO_PAGE_INDEX });
    const reader = new ParquetRangeReader(source, { footerProbeBytes: 1024 });
    await Promise.all([
      reader.prepare('data.parquet', ['observation.state'], 0, 200),
      reader.prepare('data.parquet', ['observation.state', 'action'], 0, 200),
    ]);
    const footer = parseParquetFooter(NO_PAGE_INDEX, NO_PAGE_INDEX.length);
    // Every byte at most once.
    const covered = new Uint8Array(NO_PAGE_INDEX.length);
    for (const read of source.reads) {
      for (let i = read.start; i < read.end; i++) covered[i]! += 1;
    }
    expect(Math.max(...covered)).toBe(1);
    const before = source.reads.length;
    await reader.prepare('data.parquet', ['action'], 0, 200);
    expect(source.reads.length).toBe(before);
    expect(footer.numRows).toBe(600);
  });

  it('falls back to the whole file, by name, when the server ignores ranges', async () => {
    const source = new RangeSource({ 'data.parquet': NO_PAGE_INDEX });
    source.ignoreRanges = true;
    const reader = new ParquetRangeReader(source);
    // A file larger than the footer probe, so a whole-file answer is visible.
    const padded = new Uint8Array(70_000);
    padded.set(NO_PAGE_INDEX, 0);
    (source as unknown as { files: Record<string, Uint8Array> }).files['big.bin'] = padded;
    const error = await reader.prepare('big.bin', ['index'], 0, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeFallback);
    expect((error as RangeFallback).reason).toBe('RANGE_UNSUPPORTED');
    expect((error as RangeFallback).wholeFile?.length).toBe(70_000);
    expect(reader.available).toBe(false);
    expect(reader.refusal).toBe('RANGE_UNSUPPORTED');
  });

  it('falls back when the file size cannot be known', async () => {
    const source = new RangeSource({ 'data.parquet': NO_PAGE_INDEX });
    source.failSize = true;
    const reader = new ParquetRangeReader(source);
    const error = await reader.prepare('data.parquet', ['index'], 0, 10).catch((e: unknown) => e);
    expect((error as RangeFallback).reason).toBe('RANGE_SIZE_UNKNOWN');
    expect(reader.available).toBe(false);
  });

  it('refuses one file that is not parquet without giving up ranges', async () => {
    const text = new TextEncoder().encode('{"not":"parquet"}');
    const source = new RangeSource({ 'x.parquet': text, 'data.parquet': NO_PAGE_INDEX });
    const reader = new ParquetRangeReader(source);
    const error = await reader.prepare('x.parquet', ['index'], 0, 1).catch((e: unknown) => e);
    expect((error as RangeFallback).reason).toBe('NOT_PARQUET');
    expect((error as RangeFallback).wholeFile).toEqual(text);
    expect(reader.available).toBe(true);
    await expect(reader.prepare('data.parquet', ['index'], 0, 1)).resolves.toBeTruthy();
  });
});
