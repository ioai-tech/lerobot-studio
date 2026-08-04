import { gzipSync } from 'node:zlib';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TarDataSourceLocal,
  TarGzDataSourceLocal,
  ZipDataSourceLocal,
} from '../src/platform/datasource/dataSources';
import { RemoteManifestDataSource } from '../src/platform/datasource/RemoteManifestDataSource';
import {
  DataSourceSafetyError,
  resolveSafetyLimits,
  validateEntrySizes,
  validateUntrustedPath,
} from '../src/platform/datasource/inputSafety';

afterEach(() => {
  vi.unstubAllGlobals();
});

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(new TextEncoder().encode(value).subarray(0, length), offset);
}

function tarEntry(path: string, data: Uint8Array, declaredSize = data.byteLength): Uint8Array {
  const paddedSize = Math.ceil(data.byteLength / 512) * 512;
  const result = new Uint8Array(512 + paddedSize);
  writeAscii(result, 0, 100, path);
  writeAscii(result, 100, 8, '0000644\0');
  writeAscii(result, 124, 12, `${declaredSize.toString(8).padStart(11, '0')}\0`);
  result[156] = 0x30;
  writeAscii(result, 257, 6, 'ustar\0');
  result.set(data, 512);
  return result;
}

function makeTar(entries: Array<{ path: string; data?: Uint8Array; declaredSize?: number }>): File {
  const parts = entries.map(({ path, data = new Uint8Array(), declaredSize }) =>
    tarEntry(path, data, declaredSize),
  );
  return new File([...parts, new Uint8Array(1024)], 'dataset.tar');
}

async function makeZip(paths: string[]): Promise<File> {
  const writer = new ZipWriter(new BlobWriter());
  for (const path of paths) await writer.add(path, new TextReader('{}'));
  return new File([await writer.close()], 'dataset.zip');
}

async function makeZipEntry(path: string, contents: string): Promise<File> {
  const writer = new ZipWriter(new BlobWriter());
  await writer.add(path, new TextReader(contents));
  return new File([await writer.close()], 'dataset.zip');
}

function expectSafetyCode(error: unknown, code: string): boolean {
  return error instanceof DataSourceSafetyError && error.code === code;
}

describe('untrusted archive paths', () => {
  const limits = resolveSafetyLimits({ maxPathLength: 24, maxPathDepth: 4 });

  it.each(['/meta/info.json', '\\meta\\info.json', 'C:\\meta\\info.json', '../meta/info.json'])(
    'rejects unsafe path %s',
    (path) => {
      expect(() => validateUntrustedPath(path, limits)).toThrow(DataSourceSafetyError);
    },
  );

  it('checks length and depth at their exact boundaries', () => {
    expect(validateUntrustedPath('a/b/c/d', limits)).toBe('a/b/c/d');
    expect(() => validateUntrustedPath('a/b/c/d/e', limits)).toThrowError(
      expect.objectContaining({ code: 'PATH_DEPTH_LIMIT' }),
    );
    expect(validateUntrustedPath('a'.repeat(24), limits)).toHaveLength(24);
    expect(() => validateUntrustedPath('a'.repeat(25), limits)).toThrowError(
      expect.objectContaining({ code: 'PATH_LENGTH_LIMIT' }),
    );
  });

  it('property-style checks generated traversal and absolute variants', () => {
    for (let depth = 1; depth <= 20; depth += 1) {
      const safe = Array.from({ length: depth }, (_, index) => `p${index}`).join('/');
      expect(validateUntrustedPath(safe, resolveSafetyLimits({ maxPathDepth: 20 }))).toBe(safe);
      for (const unsafe of [`/${safe}`, `../${safe}`, `${safe}/../escape`, `C:\\${safe}`]) {
        expect(() => validateUntrustedPath(unsafe, resolveSafetyLimits())).toThrow(
          DataSourceSafetyError,
        );
      }
    }
  });
});

describe('archive metadata limits', () => {
  it('rejects ZIP entry counts before extracting file data', async () => {
    const source = new ZipDataSourceLocal(await makeZip(['meta/info.json', 'data/a.json']), {
      maxArchiveEntries: 1,
    });
    await expect(source.exists('meta/info.json')).rejects.toSatisfy((error) =>
      expectSafetyCode(error, 'ENTRY_COUNT_LIMIT'),
    );
  });

  it('rejects suspicious ZIP compression ratios from central-directory metadata', async () => {
    const source = new ZipDataSourceLocal(
      await makeZipEntry('meta/info.json', '0'.repeat(1024 * 1024)),
      { compressionRatioFloorBytes: 1, maxCompressionRatio: 2 },
    );
    await expect(source.exists('meta/info.json')).rejects.toSatisfy((error) =>
      expectSafetyCode(error, 'COMPRESSION_RATIO_LIMIT'),
    );
  });

  it('rejects duplicate TAR paths', async () => {
    const source = new TarDataSourceLocal(
      makeTar([{ path: 'meta/info.json' }, { path: 'meta/info.json' }]),
    );
    await expect(source.exists('meta/info.json')).rejects.toSatisfy((error) =>
      expectSafetyCode(error, 'DUPLICATE_PATH'),
    );
  });

  it('rejects TAR traversal and oversized declarations without allocating payload size', async () => {
    const traversal = new TarDataSourceLocal(makeTar([{ path: '../meta/info.json' }]));
    await expect(traversal.exists('meta/info.json')).rejects.toSatisfy((error) =>
      expectSafetyCode(error, 'PATH_INVALID'),
    );

    const oversized = new TarDataSourceLocal(
      makeTar([{ path: 'meta/info.json', declaredSize: 10_000_000 }]),
      { maxArchiveEntryBytes: 1024 },
    );
    await expect(oversized.exists('meta/info.json')).rejects.toSatisfy((error) =>
      expectSafetyCode(error, 'ENTRY_SIZE_LIMIT'),
    );
  });

  it('enforces inclusive per-entry and total-size boundaries', () => {
    const limits = resolveSafetyLimits({
      maxArchiveEntryBytes: 10,
      maxArchiveTotalBytes: 20,
      compressionRatioFloorBytes: 100,
    });
    let total = validateEntrySizes('a', 10, 10, 0, limits);
    total = validateEntrySizes('b', 10, 10, total, limits);
    expect(total).toBe(20);
    expect(() => validateEntrySizes('c', 1, 1, total, limits)).toThrowError(
      expect.objectContaining({ code: 'TOTAL_SIZE_LIMIT' }),
    );
    expect(() => validateEntrySizes('large', 11, 11, 0, limits)).toThrowError(
      expect.objectContaining({ code: 'ENTRY_SIZE_LIMIT' }),
    );
  });

  it('caps TAR.GZ output while streaming decompression', async () => {
    const tar = makeTar([{ path: 'meta/info.json', data: new Uint8Array(2048) }]);
    const compressed = gzipSync(new Uint8Array(await tar.arrayBuffer()));
    const source = new TarGzDataSourceLocal(new File([compressed], 'dataset.tar.gz'), undefined, {
      maxTarGzOutputBytes: 1024,
      maxMaterializedBytes: 4096,
    });
    await expect(source.exists('meta/info.json')).rejects.toSatisfy((error) =>
      expectSafetyCode(error, 'TOTAL_SIZE_LIMIT'),
    );
  });
});

describe('remote manifest limits', () => {
  it.each(['javascript:alert(1)', 'file:///tmp/data', 'https://u:p@example.test/file'])(
    'rejects unsafe URL %s',
    (url) => {
      expect(
        () =>
          new RemoteManifestDataSource([
            { logicalPath: 'meta/info.json', presignedUrl: url, sizeBytes: 1 },
          ]),
      ).toThrowError(expect.objectContaining({ code: 'URL_INVALID' }));
    },
  );

  it('rejects normalized duplicate paths and oversized declared totals', () => {
    expect(
      () =>
        new RemoteManifestDataSource([
          { logicalPath: 'meta/info.json', presignedUrl: 'https://example.test/a' },
          { logicalPath: './meta/info.json', presignedUrl: 'https://example.test/b' },
        ]),
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_PATH' }));

    expect(
      () =>
        new RemoteManifestDataSource(
          [
            { logicalPath: 'a', presignedUrl: 'https://example.test/a', sizeBytes: 6 },
            { logicalPath: 'b', presignedUrl: 'https://example.test/b', sizeBytes: 5 },
          ],
          { maxManifestTotalBytes: 10 },
        ),
    ).toThrowError(expect.objectContaining({ code: 'TOTAL_SIZE_LIMIT' }));
  });

  it('stops an unknown-length response before a large allocation', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const source = new RemoteManifestDataSource(
      [{ logicalPath: 'meta/info.json', presignedUrl: 'https://example.test/info' }],
      { maxMaterializedBytes: 10 },
    );

    await expect(source.readBytes('meta/info.json')).rejects.toSatisfy((error) =>
      expectSafetyCode(error, 'MATERIALIZED_SIZE_LIMIT'),
    );
    expect(cancelled).toBe(true);
  });
});
