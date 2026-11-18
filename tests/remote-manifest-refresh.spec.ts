import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRemoteManifestDataSource,
  RemoteSourceError,
  type RemoteFileEntry,
} from '../src/react/public-api';

/**
 * A fake signing server: every refresh issues a new signature; a URL is
 * accepted only while its signature is the current one (older ones are
 * expired and answered with 403).
 */
function fakeSigningServer() {
  let signature = 1;
  let refreshCalls = 0;
  const fetches: string[] = [];
  const manifest = (expiresInMs = 3_600_000): RemoteFileEntry[] => [
    {
      logicalPath: 'meta/info.json',
      presignedUrl: `https://cdn.example.test/info.json?sig=${signature}`,
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    },
    {
      logicalPath: 'videos/cam/chunk-000/file-000.mp4',
      presignedUrl: `https://cdn.example.test/cam.mp4?sig=${signature}`,
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    },
  ];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    fetches.push(url.toString());
    if (url.searchParams.get('sig') !== String(signature)) {
      return new Response('expired', { status: 403 });
    }
    return new Response('{"ok":true}', { status: 200 });
  });
  return {
    manifest,
    fetchImpl,
    fetches,
    get refreshCalls() {
      return refreshCalls;
    },
    /** Expire every URL issued so far. */
    rotate() {
      signature += 1;
    },
    refresh: async (expiresInMs?: number) => {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return manifest(expiresInMs);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('remote manifest URL refresh', () => {
  it('refreshes once on 403 and retries the read once', async () => {
    const server = fakeSigningServer();
    vi.stubGlobal('fetch', server.fetchImpl);
    const source = createRemoteManifestDataSource(server.manifest(), {
      refresh: () => server.refresh(),
    });
    server.rotate();

    await expect(source.readText('meta/info.json')).resolves.toBe('{"ok":true}');
    expect(server.refreshCalls).toBe(1);
    expect(server.fetches).toEqual([
      'https://cdn.example.test/info.json?sig=1',
      'https://cdn.example.test/info.json?sig=2',
    ]);
  });

  it('shares one refresh between concurrent failures', async () => {
    const server = fakeSigningServer();
    vi.stubGlobal('fetch', server.fetchImpl);
    const source = createRemoteManifestDataSource(server.manifest(), {
      refresh: () => server.refresh(),
    });
    server.rotate();

    const reads = await Promise.all([
      source.readText('meta/info.json'),
      source.readText('videos/cam/chunk-000/file-000.mp4'),
      source.readText('meta/info.json'),
    ]);
    expect(reads).toEqual(['{"ok":true}', '{"ok":true}', '{"ok":true}']);
    expect(server.refreshCalls).toBe(1);
  });

  it('refreshes before handing out a URL within 60 s of expiry', async () => {
    const server = fakeSigningServer();
    vi.stubGlobal('fetch', server.fetchImpl);
    const source = createRemoteManifestDataSource(server.manifest(30_000), {
      refresh: () => server.refresh(),
    });
    server.rotate();

    await expect(source.getObjectUrl('videos/cam/chunk-000/file-000.mp4')).resolves.toBe(
      'https://cdn.example.test/cam.mp4?sig=2',
    );
    expect(server.refreshCalls).toBe(1);
    expect(server.fetches).toEqual([]);
  });

  it('uses the manifest-wide expiresAt for entries without their own', async () => {
    const server = fakeSigningServer();
    vi.stubGlobal('fetch', server.fetchImpl);
    const files = server.manifest().map(({ expiresAt: _drop, ...entry }) => entry);
    const source = createRemoteManifestDataSource(files, {
      refresh: () => server.refresh(),
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    });
    server.rotate();
    await expect(source.getObjectUrl('meta/info.json')).resolves.toBe(
      'https://cdn.example.test/info.json?sig=2',
    );
  });

  it('surfaces a typed error after the one retry, without looping', async () => {
    const fetchImpl = vi.fn(async () => new Response('denied', { status: 403 }));
    vi.stubGlobal('fetch', fetchImpl);
    const refresh = vi.fn(async () => [
      { logicalPath: 'meta/info.json', presignedUrl: 'https://cdn.example.test/info.json?sig=9' },
    ]);
    const source = createRemoteManifestDataSource(
      [{ logicalPath: 'meta/info.json', presignedUrl: 'https://cdn.example.test/info.json?sig=1' }],
      { refresh },
    );

    const error = await source.readText('meta/info.json').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RemoteSourceError);
    expect(error).toMatchObject({ code: 'HTTP_STATUS', status: 403, path: 'meta/info.json' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats a CORS-less network failure as a possibly expired URL', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return new Response('ok', { status: 200 });
      }),
    );
    const refresh = vi.fn(async () => [
      { logicalPath: 'meta/info.json', presignedUrl: 'https://cdn.example.test/info.json?sig=2' },
    ]);
    const source = createRemoteManifestDataSource(
      [{ logicalPath: 'meta/info.json', presignedUrl: 'https://cdn.example.test/info.json?sig=1' }],
      { refresh },
    );
    await expect(source.readText('meta/info.json')).resolves.toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not retry without a refresh callback and keeps non-auth errors typed', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchImpl);
    const source = createRemoteManifestDataSource([
      { logicalPath: 'meta/info.json', presignedUrl: 'https://cdn.example.test/info.json?sig=1' },
    ]);
    await expect(source.readText('meta/info.json')).rejects.toMatchObject({
      code: 'HTTP_STATUS',
      status: 404,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('notifies URL subscribers with the paths that changed and swaps by path', async () => {
    const server = fakeSigningServer();
    vi.stubGlobal('fetch', server.fetchImpl);
    const source = createRemoteManifestDataSource(server.manifest(), {
      refresh: () => server.refresh(),
    });
    const changes: string[][] = [];
    const unsubscribe = source.subscribeUrlChanges!((paths) => changes.push([...paths]));
    server.rotate();
    await source.invalidateObjectUrl!('videos/cam/chunk-000/file-000.mp4');

    expect(changes).toEqual([['meta/info.json', 'videos/cam/chunk-000/file-000.mp4']]);
    await expect(source.getObjectUrl('videos/cam/chunk-000/file-000.mp4')).resolves.toBe(
      'https://cdn.example.test/cam.mp4?sig=2',
    );
    unsubscribe();
  });

  it('refreshes proactively before expiry while a URL is held', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-01-01T00:00:00Z') });
    const server = fakeSigningServer();
    vi.stubGlobal('fetch', server.fetchImpl);
    const source = createRemoteManifestDataSource(server.manifest(5 * 60_000), {
      refresh: () => server.refresh(5 * 60_000),
    });
    const changes: string[][] = [];
    source.subscribeUrlChanges!((paths) => changes.push([...paths]));
    server.rotate();

    await vi.advanceTimersByTimeAsync(4 * 60_000 - 1_000);
    expect(server.refreshCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.refreshCalls).toBe(1);
    expect(changes).toHaveLength(1);
    source.clear();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(server.refreshCalls).toBe(1);
  });

  it('validates the episode scope', () => {
    expect(() =>
      createRemoteManifestDataSource(
        [{ logicalPath: 'meta/info.json', presignedUrl: 'https://cdn.example.test/a' }],
        { episodeScope: [1, -2] },
      ),
    ).toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
    const source = createRemoteManifestDataSource(
      [{ logicalPath: 'meta/info.json', presignedUrl: 'https://cdn.example.test/a' }],
      { episodeScope: [3, 1, 3] },
    );
    expect(source.episodeScope).toEqual([1, 3]);
  });
});
