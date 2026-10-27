import { describe, expect, it, vi } from 'vitest';
import { createRemoteManifestDataSource } from '../src/react/public-api';

describe('createRemoteManifestDataSource', () => {
  it('exposes listPaths and getObjectUrl for host-signed files', async () => {
    const source = createRemoteManifestDataSource([
      {
        logicalPath: './videos/cam.mp4',
        presignedUrl: 'https://cdn.example.test/cam.mp4?sig=1',
        contentType: 'video/mp4',
        sizeBytes: 1024,
      },
      {
        logicalPath: 'meta/info.json',
        presignedUrl: 'https://cdn.example.test/info.json?sig=1',
      },
    ]);

    await expect(source.exists('videos/cam.mp4')).resolves.toBe(true);
    await expect(source.listPaths?.()).resolves.toEqual(['videos/cam.mp4', 'meta/info.json']);
    await expect(source.getObjectUrl('videos/cam.mp4')).resolves.toBe(
      'https://cdn.example.test/cam.mp4?sig=1',
    );
  });
});

describe('remote manifest range reads', () => {
  const files = [
    {
      logicalPath: 'data/chunk-000/file-000.parquet',
      presignedUrl: 'https://cdn.example.test/data.parquet?sig=1',
      sizeBytes: 4096,
    },
    {
      logicalPath: 'meta/episodes/chunk-000/file-000.parquet',
      presignedUrl: 'https://cdn.example.test/episodes.parquet?sig=1',
    },
  ];

  it('sends one Range request and returns the partial body', async () => {
    const calls: Array<{ url: string; range: string | null }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, range: new Headers(init?.headers).get('range') });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 });
    });
    try {
      const source = createRemoteManifestDataSource(files);
      await expect(source.getSize?.('data/chunk-000/file-000.parquet')).resolves.toBe(4096);
      const bytes = await source.readRange!('data/chunk-000/file-000.parquet', 100, 4);
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
      expect(calls).toEqual([
        { url: 'https://cdn.example.test/data.parquet?sig=1', range: 'bytes=100-103' },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a server that ignores Range instead of downloading the whole file', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(4096), { status: 200 }));
    try {
      const source = createRemoteManifestDataSource(files);
      await expect(source.readRange!('data/chunk-000/file-000.parquet', 0, 8)).rejects.toThrow(
        /ignored Range/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads a missing size from Content-Range of a one-byte GET (presigned URLs refuse HEAD)', async () => {
    const requests: Array<{ method: string; range: string | null }> = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, range: new Headers(init?.headers).get('range') });
      if (method !== 'GET') return new Response(null, { status: 403 });
      return new Response(new Uint8Array([1]), {
        status: 206,
        headers: { 'content-range': 'bytes 0-0/777' },
      });
    });
    try {
      const source = createRemoteManifestDataSource(files);
      const path = 'meta/episodes/chunk-000/file-000.parquet';
      await expect(source.getSize?.(path)).resolves.toBe(777);
      await expect(source.getSize?.(path)).resolves.toBe(777);
      expect(requests).toEqual([{ method: 'GET', range: 'bytes=0-0' }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails a size lookup without Content-Range once, and does not repeat it at once', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      // a cross-origin store that does not expose Content-Range
      return new Response(new Uint8Array([1]), { status: 206 });
    });
    try {
      const source = createRemoteManifestDataSource(files);
      const path = 'meta/episodes/chunk-000/file-000.parquet';
      await expect(source.getSize?.(path)).rejects.toThrow(/no size/);
      await expect(source.getSize?.(path)).rejects.toThrow(/no size/);
      expect(calls).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('remote manifest URL refresh', () => {
  const path = 'data/chunk-000/file-000.parquet';
  const entry = (sig: number, expiresAt?: string) => ({
    logicalPath: path,
    presignedUrl: `https://cdn.example.test/data.parquet?sig=${sig}`,
    sizeBytes: 64,
    expiresAt,
  });

  it('renews and retries once when the store refuses an expired signature', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return url.endsWith('sig=1')
        ? new Response('expired', { status: 403 })
        : new Response(new Uint8Array([9]), { status: 206 });
    });
    try {
      let refreshes = 0;
      const source = createRemoteManifestDataSource([entry(1)], {
        refresh: async () => {
          refreshes += 1;
          return [entry(2)];
        },
      });
      const bytes = await source.readRange!(path, 0, 1);
      expect(Array.from(bytes)).toEqual([9]);
      expect(urls).toEqual([
        'https://cdn.example.test/data.parquet?sig=1',
        'https://cdn.example.test/data.parquet?sig=2',
      ]);
      expect(refreshes).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renews before the earliest expiry, once for concurrent callers', async () => {
    let refreshes = 0;
    const soon = new Date(Date.now() + 30_000).toISOString();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const source = createRemoteManifestDataSource([entry(1, soon)], {
      refresh: async () => {
        refreshes += 1;
        return [entry(2, later)];
      },
    });
    const [first, second] = await Promise.all([
      source.getObjectUrl(path),
      source.getObjectUrl(path),
    ]);
    expect(first).toBe('https://cdn.example.test/data.parquet?sig=2');
    expect(second).toBe(first);
    expect(refreshes).toBe(1);
    await source.getObjectUrl(path);
    expect(refreshes).toBe(1);
  });

  it('hands a media element a fresh URL after it failed on the old one', async () => {
    let sig = 1;
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const source = createRemoteManifestDataSource([entry(1, later)], {
      refresh: async () => [entry(++sig, later)],
    });
    expect(await source.getObjectUrl(path)).toMatch(/sig=1$/);
    await source.invalidateObjectUrl?.(path);
    expect(await source.getObjectUrl(path)).toMatch(/sig=2$/);
  });

  it('renews ahead of the expiry at most every 30 s, and keeps the URL when that fails', async () => {
    let refreshes = 0;
    let fail = false;
    const soon = () => new Date(Date.now() + 60_000).toISOString();
    const source = createRemoteManifestDataSource([entry(1, soon())], {
      refresh: async () => {
        refreshes += 1;
        if (fail) throw new Error('host down');
        // a host that hands out URLs as short-lived as before
        return [entry(1 + refreshes, soon())];
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      expect(await source.getObjectUrl(path)).toMatch(/sig=2$/);
      for (let i = 0; i < 5; i++) await source.getObjectUrl(path);
      expect(refreshes).toBe(1);
      vi.setSystemTime(Date.now() + 31_000);
      fail = true;
      // the failed proactive renewal leaves the current URL in use
      expect(await source.getObjectUrl(path)).toMatch(/sig=2$/);
      expect(refreshes).toBe(2);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it('keeps counting the expiry of paths a refresh left out', async () => {
    const other = 'data/chunk-000/file-001.parquet';
    const soon = new Date(Date.now() + 30_000).toISOString();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    let refreshes = 0;
    const source = createRemoteManifestDataSource(
      [entry(1, later), { ...entry(1, soon), logicalPath: other }],
      {
        refresh: async () => {
          refreshes += 1;
          return [entry(2, later)];
        },
      },
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await source.getObjectUrl(path);
      expect(refreshes).toBe(1);
      vi.setSystemTime(Date.now() + 31_000);
      // `other` still expires soon: the next request renews again
      await source.getObjectUrl(path);
      expect(refreshes).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
