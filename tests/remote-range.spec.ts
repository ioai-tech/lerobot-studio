import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEpisodeSetDataSource,
  createRemoteManifestDataSource,
  RemoteSourceError,
} from '../src/react/public-api';

const FILE = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

type Mode = 'range' | 'ignore' | 'no-content-range';

/** A file server answering Range requests like a CDN (or not, per `mode`). */
function server(mode: Mode, expiredSignatures: Set<string> = new Set()) {
  const requests: Array<{ url: string; range: string | null }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const range = new Headers(init?.headers).get('range');
    requests.push({ url: url.toString(), range });
    if (expiredSignatures.has(url.searchParams.get('sig') ?? '')) {
      return new Response('expired', { status: 403 });
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
    if (!match || mode === 'ignore') return new Response(FILE.slice(), { status: 200 });
    let start: number;
    let end: number;
    if (match[1] === '') {
      start = Math.max(0, FILE.length - Number(match[2]));
      end = FILE.length - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? FILE.length - 1 : Math.min(Number(match[2]), FILE.length - 1);
    }
    const headers: Record<string, string> = {};
    if (mode === 'range') headers['Content-Range'] = `bytes ${start}-${end}/${FILE.length}`;
    return new Response(FILE.slice(start, end + 1), { status: 206, headers });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return { requests };
}

const entry = (sizeBytes: number | null, sig = '1') => ({
  logicalPath: 'data/chunk-000/file-000.parquet',
  presignedUrl: `https://cdn.example.test/file.parquet?sig=${sig}`,
  sizeBytes,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remote readRange', () => {
  it('sends a plain bytes=a-b range when the manifest knows the size', async () => {
    const { requests } = server('range');
    const source = createRemoteManifestDataSource([entry(FILE.length)]);
    const tail = await source.readRange!('data/chunk-000/file-000.parquet', -100);
    expect(requests.at(-1)!.range).toBe('bytes=900-999');
    expect(tail).toEqual({ bytes: FILE.slice(900), start: 900, size: 1000 });
    const middle = await source.readRange!('data/chunk-000/file-000.parquet', 10, 20);
    expect(requests.at(-1)!.range).toBe('bytes=10-19');
    expect(middle).toEqual({ bytes: FILE.slice(10, 20), start: 10, size: 1000 });
  });

  it('reads the size from Content-Range without one', async () => {
    const { requests } = server('range');
    const source = createRemoteManifestDataSource([entry(null)]);
    const tail = await source.readRange!('data/chunk-000/file-000.parquet', -100);
    expect(requests.at(-1)!.range).toBe('bytes=-100');
    expect(tail).toEqual({ bytes: FILE.slice(900), start: 900, size: 1000 });
  });

  it('names a size it cannot know', async () => {
    server('no-content-range');
    const source = createRemoteManifestDataSource([entry(null)]);
    const error = await source.readRange!('data/chunk-000/file-000.parquet', -100).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RemoteSourceError);
    expect((error as RemoteSourceError).code).toBe('RANGE_SIZE_UNKNOWN');
  });

  it('returns the whole file when the server ignores the range', async () => {
    server('ignore');
    const source = createRemoteManifestDataSource([entry(FILE.length)]);
    const result = await source.readRange!('data/chunk-000/file-000.parquet', -100);
    expect(result.start).toBe(0);
    expect(result.size).toBe(1000);
    expect(result.bytes).toEqual(FILE);
  });

  it('keeps the range across one signed-URL refresh', async () => {
    const { requests } = server('range', new Set(['1']));
    const source = createRemoteManifestDataSource([entry(FILE.length, '1')], {
      refresh: async () => [entry(FILE.length, '2')],
    });
    const result = await source.readRange!('data/chunk-000/file-000.parquet', 0, 4);
    expect(
      requests.map((request) => [new URL(request.url).searchParams.get('sig'), request.range]),
    ).toEqual([
      ['1', 'bytes=0-3'],
      ['2', 'bytes=0-3'],
    ]);
    expect(result.bytes).toEqual(FILE.slice(0, 4));
  });

  it('reads ranges of an episode set recording', async () => {
    const { requests } = server('range');
    const source = createEpisodeSetDataSource(
      {
        fps: 30,
        features: { timestamp: { dtype: 'float32', shape: [1], names: null } },
        recordings: [{ id: 'r0' }],
        episodes: [{ recordingId: 'r0', task: 't', fromRow: 0, toRow: 10, fromS: 0, toS: 1 }],
      },
      { resolve: async (ids) => ids.map((id) => ({ id, files: [entry(FILE.length)] })) },
    );
    const result = await source.readRange!('data/chunk-000/file-000.parquet', 100, 110);
    expect(requests.at(-1)!.range).toBe('bytes=100-109');
    expect(result).toEqual({ bytes: FILE.slice(100, 110), start: 100, size: 1000 });
  });
});
