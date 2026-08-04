import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createArchiveDataSourceFromFile,
  createArchiveDataSourceFromUrl,
  getArchiveBasename,
  getArchiveKindFromFile,
  getArchiveKindFromHeaders,
  getArchiveKindFromMagicBytes,
  getArchiveKindFromUrl,
} from '../src/platform/datasource/ArchiveDataSourceFactory';
import {
  FileListDirectoryDataSource,
  RemoteFullArchiveDataSource,
  TarDataSourceHttp,
  TarDataSourceLocal,
  TarGzDataSourceHttp,
  TarGzDataSourceLocal,
  ZipDataSourceHttp,
  ZipDataSourceLocal,
} from '../src/platform/datasource/dataSources';
import { DataSourceSafetyError } from '../src/platform/datasource/inputSafety';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function makeZip(entries: Record<string, string>): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter());
  for (const [path, text] of Object.entries(entries)) {
    await writer.add(path, new TextReader(text));
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

function makeTar(path: string, text: string): Uint8Array {
  const data = new TextEncoder().encode(text);
  const result = new Uint8Array(512 + Math.ceil(data.byteLength / 512) * 512 + 1024);
  result.set(new TextEncoder().encode(path), 0);
  result.set(new TextEncoder().encode(`${data.byteLength.toString(8).padStart(11, '0')}\0`), 124);
  result[156] = 0x30;
  result.set(new TextEncoder().encode('ustar\0'), 257);
  result.set(data, 512);
  return result;
}

describe('archive type detection and construction', () => {
  it.each([
    ['https://example.test/data.TAR.GZ?token=1', 'targz'],
    ['https://example.test/download?filename=data.tar.gz', 'targz'],
    ['https://example.test/download?filename=data.tgz', 'targz'],
    ['https://example.test/data.tar#fragment', 'tar'],
    ['https://example.test/download?filename=data.tar', 'tar'],
    ['https://example.test/download?filename=data.zip', 'zip'],
    ['not a url/dataset.zip?token=1', 'zip'],
    ['https://example.test/no-extension', null],
  ] as const)('detects %s as %s', (url, kind) => {
    expect(getArchiveKindFromUrl(url)).toBe(kind);
  });

  it('detects file names, response headers, and archive signatures', () => {
    expect(getArchiveKindFromFile(new File([], 'DATA.TGZ'))).toBe('targz');
    expect(getArchiveKindFromFile(new File([], 'data.tar'))).toBe('tar');
    expect(getArchiveKindFromFile(new File([], 'data.zip'))).toBe('zip');
    expect(getArchiveKindFromFile(new File([], 'data.bin'))).toBeNull();

    expect(
      getArchiveKindFromHeaders(
        new Headers({ 'content-disposition': 'attachment; filename="dataset.tar.gz"' }),
      ),
    ).toBe('targz');
    expect(
      getArchiveKindFromHeaders(
        new Headers({ 'content-disposition': 'attachment; filename="dataset.tar"' }),
      ),
    ).toBe('tar');
    expect(
      getArchiveKindFromHeaders(
        new Headers({ 'content-disposition': 'attachment; filename="dataset.zip"' }),
      ),
    ).toBe('zip');
    expect(getArchiveKindFromHeaders(new Headers({ 'content-type': 'application/x-tar' }))).toBe(
      'tar',
    );
    expect(getArchiveKindFromHeaders(new Headers({ 'content-type': 'application/zip' }))).toBe(
      'zip',
    );
    expect(getArchiveKindFromHeaders(new Headers({ 'content-type': 'application/gzip' }))).toBe(
      'targz',
    );
    expect(
      getArchiveKindFromHeaders(
        new Headers({ 'content-type': 'application/x-gzip; charset=binary' }),
      ),
    ).toBe('targz');
    expect(getArchiveKindFromHeaders(new Headers())).toBeNull();

    expect(getArchiveKindFromMagicBytes(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe('zip');
    expect(getArchiveKindFromMagicBytes(new Uint8Array([0x1f, 0x8b]))).toBe('targz');
    const tar = new Uint8Array(262);
    tar.set(new TextEncoder().encode('ustar'), 257);
    expect(getArchiveKindFromMagicBytes(tar)).toBe('tar');
    expect(getArchiveKindFromMagicBytes(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('selects local, ranged remote, and full-download implementations', async () => {
    expect(createArchiveDataSourceFromFile(new File([], 'a.zip'))).toBeInstanceOf(
      ZipDataSourceLocal,
    );
    expect(createArchiveDataSourceFromFile(new File([], 'a.tar'))).toBeInstanceOf(
      TarDataSourceLocal,
    );
    const gzipBytes = gzipSync(makeTar('meta/info.json', '{}'));
    const zipBytes = await makeZip({ 'meta/info.json': '{}' });
    const tarBytes = makeTar('meta/info.json', '{}');
    const localTarGz = createArchiveDataSourceFromFile(new File([gzipBytes], 'a.tgz'));
    expect(localTarGz).toBeInstanceOf(TarGzDataSourceLocal);
    await expect(localTarGz.exists('meta/info.json')).resolves.toBe(true);
    expect(() => createArchiveDataSourceFromFile(new File([], 'a.bin'))).toThrow(
      /unsupported archive type/i,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('.zip')) {
          return new Response(zipBytes, { status: 200 });
        }
        if (url.includes('.tgz') || url.includes('.tar.gz')) {
          return new Response(gzipBytes, { status: 200 });
        }
        if (url.includes('.tar')) {
          return new Response(tarBytes, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    expect(createArchiveDataSourceFromUrl('https://example.test/a.zip')).toBeInstanceOf(
      ZipDataSourceHttp,
    );
    const remoteTar = createArchiveDataSourceFromUrl('https://example.test/a.tar');
    expect(remoteTar).toBeInstanceOf(TarDataSourceHttp);
    await expect(remoteTar.exists('meta/info.json')).resolves.toBe(true);
    const remoteTarGz = createArchiveDataSourceFromUrl('https://example.test/a.tgz');
    expect(remoteTarGz).toBeInstanceOf(TarGzDataSourceHttp);
    await expect(remoteTarGz.exists('meta/info.json')).resolves.toBe(true);
    expect(
      createArchiveDataSourceFromUrl('https://example.test/download', undefined, 'zip', {
        accessMode: 'full',
      }),
    ).toBeInstanceOf(RemoteFullArchiveDataSource);
    expect(() => createArchiveDataSourceFromUrl('https://example.test/file')).toThrow(
      /unsupported archive type/i,
    );
  });

  it('decodes archive basenames without throwing on malformed escapes', () => {
    expect(getArchiveBasename('https://example.test/path/my%2520dataset.zip?token=1')).toBe(
      'my dataset.zip',
    );
    expect(getArchiveBasename('not-a-url/path/%E0%A4%A.zip?token=1')).toBe('%E0%A4%A.zip');
  });
});

describe('data source resource and download behavior', () => {
  it('resolves a selected directory root and reads files through normalized paths', async () => {
    const info = new File(['{"codebase_version":"v3.0"}'], 'info.json');
    Object.defineProperty(info, 'webkitRelativePath', { value: 'dataset/meta/info.json' });
    const data = new File(['payload'], 'part.txt');
    Object.defineProperty(data, 'webkitRelativePath', { value: 'dataset/data/part.txt' });
    const source = new FileListDirectoryDataSource([info, data]);

    await expect(source.listPaths()).resolves.toEqual(['meta/info.json', 'data/part.txt']);
    await expect(source.exists('./meta//info.json')).resolves.toBe(true);
    await expect(source.readText('data/part.txt')).resolves.toBe('payload');
    await expect(source.readBytes('missing')).rejects.toThrow(/file not found/i);
    source.clear();
  });

  it('caches and invalidates selected-directory object URLs by logical path', async () => {
    const info = new File(['{}'], 'info.json');
    Object.defineProperty(info, 'webkitRelativePath', { value: 'root/meta/info.json' });
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const source = new FileListDirectoryDataSource([info]);

    await expect(source.getObjectUrl('meta/info.json', 'application/json')).resolves.toBe(
      'blob:first',
    );
    await expect(source.getObjectUrl('meta/info.json', 'application/json')).resolves.toBe(
      'blob:first',
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    await source.invalidateObjectUrl('./meta/info.json');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
    await expect(source.getObjectUrl('meta/info.json', 'application/json')).resolves.toBe(
      'blob:second',
    );
    source.clear();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
  });

  it('reads rooted ZIP entries and releases cached object URLs', async () => {
    const zip = await makeZip({
      'dataset/meta/info.json': '{"codebase_version":"v3.0"}',
      'dataset/data/value.txt': 'value',
    });
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:zip')
      .mockReturnValueOnce('blob:new');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const source = new ZipDataSourceLocal(new File([zip], 'dataset.zip'));

    await expect(source.listPaths()).resolves.toEqual(['meta/info.json', 'data/value.txt']);
    await expect(source.readBytes('data/value.txt')).resolves.toEqual(
      new TextEncoder().encode('value'),
    );
    await expect(source.readText('missing')).rejects.toThrow(/file not found/i);
    const [first, concurrent] = await Promise.all([
      source.getObjectUrl('data/value.txt', 'text/plain'),
      source.getObjectUrl('data/value.txt', 'text/plain'),
    ]);
    expect(first).toBe('blob:zip');
    expect(concurrent).toBe(first);
    await source.invalidateObjectUrl('data/value.txt');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:zip');
    await expect(source.getObjectUrl('data/value.txt', 'text/plain')).resolves.toBe('blob:new');
    await source.clear();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:new');
  });

  it('reads local TAR entries, reports progress, and resets after clear', async () => {
    const progress = vi.fn();
    const source = new TarDataSourceLocal(
      new File([makeTar('root/meta/info.json', '{"codebase_version":"v3.0"}')], 'dataset.tar'),
    );

    await expect(source.exists('meta/info.json')).resolves.toBe(true);
    await expect(source.readText('meta/info.json', progress)).resolves.toContain('v3.0');
    await expect(source.readBytes('missing')).rejects.toThrow(/file not found in tar/i);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'read' }));
    source.clear();
    await expect(source.exists('meta/info.json')).resolves.toBe(true);
  });

  it('downloads a small full ZIP once, delegates reads, and releases it on clear', async () => {
    const bytes = await makeZip({ 'root/meta/info.json': '{"codebase_version":"v3.0"}' });
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { storage: {} });
    const source = new RemoteFullArchiveDataSource(
      'https://example.test/dataset',
      'zip',
      undefined,
      bytes.byteLength + 1,
    );

    await expect(source.exists('meta/info.json')).resolves.toBe(true);
    await expect(source.readText('meta/info.json')).resolves.toContain('v3.0');
    await expect(source.listPaths()).resolves.toEqual(['meta/info.json']);
    expect(fetchMock).toHaveBeenCalledOnce();
    await source.clear();
  });

  it('rejects failed complete archive downloads', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 403 })),
    );
    await expect(
      new RemoteFullArchiveDataSource('https://example.test/forbidden', 'zip').exists(
        'meta/info.json',
      ),
    ).rejects.toThrow(/403/);
  });

  it('enforces maxBytes from Content-Length without OPFS and cancels the body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('navigator', { storage: {} });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-length': '8' },
          }),
      ),
    );
    const source = new RemoteFullArchiveDataSource(
      'https://example.test/declared-large',
      'zip',
      undefined,
      4,
    );

    await expect(source.exists('meta/info.json')).rejects.toSatisfy(
      (error) =>
        error instanceof DataSourceSafetyError &&
        error.code === 'MATERIALIZED_SIZE_LIMIT' &&
        error.details.limit === 4,
    );
    expect(cancelled).toBe(true);
  });

  it('enforces maxBytes while streaming without OPFS and cancels the reader', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('navigator', { storage: {} });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const source = new RemoteFullArchiveDataSource(
      'https://example.test/streamed-large',
      'tar',
      undefined,
      4,
    );

    await expect(source.exists('meta/info.json')).rejects.toSatisfy(
      (error) =>
        error instanceof DataSourceSafetyError &&
        error.code === 'MATERIALIZED_SIZE_LIMIT' &&
        error.details.limit === 4 &&
        error.details.loaded === 6,
    );
    expect(cancelled).toBe(true);
  });
});
