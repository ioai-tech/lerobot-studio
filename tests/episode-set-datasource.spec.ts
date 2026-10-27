import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const { readParquetToIPC, readNumericColumns, readFeatureData } =
    await import('./helpers/parquet');
  const range = await import('../src/platform/workers/parquetRange');
  return {
    createParquetWorker: () => ({
      readParquet: async (buffer: ArrayBuffer, columns?: string[]) =>
        readParquetToIPC(new Uint8Array(buffer), columns),
      readNumericColumns: async (buffer: ArrayBuffer, columns: string[], a: number, b: number) =>
        readNumericColumns(new Uint8Array(buffer), columns, a, b),
      readFeatureData: async (buffer: ArrayBuffer, columns: string[], a: number, b: number) =>
        readFeatureData(new Uint8Array(buffer), columns, a, b),
      readNumericColumnsRange: range.readNumericColumnsRange,
      readFeatureDataRange: range.readFeatureRowsRange,
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import { LeRobotDataLoader } from '@/platform';
import { RANGE_RETRY_POLICY } from '../src/platform/services/LeRobotDataLoader';
import {
  createEpisodeSetDataSource,
  EPISODE_SET_PREVIEW_VIDEO_PATH,
  type EpisodeSetRecording,
} from '../src/react/public-api';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/datasets/lerobotv3',
);
const info = JSON.parse(await fs.readFile(path.join(fixture, 'meta/info.json'), 'utf-8'));

/** A recording tree served from the fixture under https://store.test/<id>/<path>. */
async function recording(id: string, preview = false): Promise<EpisodeSetRecording> {
  const paths = ['meta/info.json', 'data/chunk-000/file-000.parquet'];
  paths.push('videos/observation.images.cam/chunk-000/file-000.mp4');
  if (preview) paths.push('preview/observation.images.cam.mp4');
  return {
    id,
    previewVideoPath: preview ? 'preview/{video_key}.mp4' : null,
    files: await Promise.all(
      paths.map(async (logicalPath) => ({
        logicalPath,
        presignedUrl: `https://store.test/${id}/${logicalPath}?sig=1`,
        sizeBytes: (await fs.stat(path.join(fixture, fixturePath(logicalPath)))).size,
      })),
    ),
  };
}

function fixturePath(logicalPath: string): string {
  return logicalPath.startsWith('preview/')
    ? 'videos/observation.images.cam/chunk-000/file-001.mp4'
    : logicalPath;
}

describe('createEpisodeSetDataSource', () => {
  const requested: string[] = [];

  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requested.push(url);
      const logicalPath = new URL(url).pathname.split('/').slice(2).join('/');
      const bytes = await fs.readFile(path.join(fixture, fixturePath(logicalPath)));
      const header = new Headers(init?.headers).get('range');
      const match = header ? /^bytes=(\d+)-(\d+)$/.exec(header) : null;
      if (!match) return new Response(bytes, { status: 200 });
      return new Response(bytes.subarray(Number(match[1]), Number(match[2]) + 1), {
        status: 206,
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    requested.length = 0;
  });

  it('plays row ranges of several recordings as one v3 dataset', async () => {
    const source = createEpisodeSetDataSource({
      fps: info.fps,
      features: info.features,
      recordings: [await recording('a'), await recording('b', true)],
      episodes: [
        { recordingId: 'a', task: 'pick', fromRow: 2, toRow: 5, fromS: 0.2, toS: 0.5 },
        { recordingId: 'b', task: 'place', fromRow: 0, toRow: 3, fromS: 0, toS: 0.3 },
      ],
    });
    const loader = new LeRobotDataLoader(source);
    await loader.initialize();

    expect(loader.getEpisodes().map((e) => e.tasks)).toEqual([['pick'], ['place']]);
    expect(loader.getEpisodeDataPath(0)).toMatchObject({
      path: 'data/chunk-000/file-000.parquet',
      startRow: 2,
      endRow: 5,
    });
    expect(loader.getEpisodeDataPath(1)).toMatchObject({
      path: 'data/chunk-000/file-001.parquet',
      startRow: 0,
      endRow: 3,
    });

    const columns = await loader.loadAllNumericalData(0, ['index']);
    expect(Array.from(columns.index.values)).toEqual([2, 3, 4]);
    expect(requested.every((url) => url.startsWith('https://store.test/a/'))).toBe(true);

    expect(loader.getEpisodeVideoPath(1, 'observation.images.cam')).toEqual({
      path: 'videos/observation.images.cam/chunk-000/file-001.mp4',
      fromSec: 0,
      toSec: 0.3,
    });
    const preview = loader.getEpisodeVideoPath(
      1,
      'observation.images.cam',
      EPISODE_SET_PREVIEW_VIDEO_PATH,
    );
    await expect(source.exists(preview!.path)).resolves.toBe(true);
    await expect(source.getObjectUrl(preview!.path)).resolves.toBe(
      'https://store.test/b/preview/observation.images.cam.mp4?sig=1',
    );
    // recording a has no preview: the viewer falls back to its original video
    const missing = loader.getEpisodeVideoPath(
      0,
      'observation.images.cam',
      EPISODE_SET_PREVIEW_VIDEO_PATH,
    );
    await expect(source.exists(missing!.path)).resolves.toBe(false);
    await loader.dispose();
  });

  it('maps a refresh to the recordings by id, whatever its order or omissions', async () => {
    const signed = async (id: string, sig: number) => {
      const rec = await recording(id);
      rec.files = rec.files.map((file) => ({
        ...file,
        presignedUrl: file.presignedUrl.replace('sig=1', `sig=${sig}`),
      }));
      return rec;
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let refreshed: EpisodeSetRecording[] = [];
    const source = createEpisodeSetDataSource(
      {
        fps: info.fps,
        features: info.features,
        recordings: [await recording('a'), await recording('b'), await recording('c')],
        episodes: [{ recordingId: 'a', task: 't', fromRow: 0, toRow: 1, fromS: 0, toS: 0.1 }],
      },
      { refresh: async () => refreshed },
    );
    const video = (slot: number) => `videos/observation.images.cam/chunk-000/file-00${slot}.mp4`;
    // reversed, and recording b left out
    refreshed = [await signed('c', 2), await signed('x', 2), await signed('a', 2)];
    await source.invalidateObjectUrl?.(video(0));
    expect(await source.getObjectUrl(video(0))).toBe(
      'https://store.test/a/videos/observation.images.cam/chunk-000/file-000.mp4?sig=2',
    );
    expect(await source.getObjectUrl(video(1))).toBe(
      'https://store.test/b/videos/observation.images.cam/chunk-000/file-000.mp4?sig=1',
    );
    expect(await source.getObjectUrl(video(2))).toBe(
      'https://store.test/c/videos/observation.images.cam/chunk-000/file-000.mp4?sig=2',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh does not match'),
      expect.objectContaining({ unknown: ['x'], missing: ['b'] }),
    );
    warn.mockRestore();
  });

  it('reads a file whole when its size or Range is not available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unsized = async (id: string) => {
      const rec = await recording(id);
      rec.files = rec.files.map((file) => ({ ...file, sizeBytes: null }));
      return rec;
    };
    // 1: a store that does not expose Content-Range (the size lookup fails)
    // 2: a server that ignores Range (answers 200 with the whole file)
    for (const mode of ['no-content-range', 'ignores-range'] as const) {
      // footers and blocks of earlier tests would answer without a request
      (await import('../src/platform/workers/parquetRange')).clearRangeMetadataCache();
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        requested.push(url);
        const logicalPath = new URL(url).pathname.split('/').slice(2).join('/');
        const bytes = await fs.readFile(path.join(fixture, fixturePath(logicalPath)));
        const header = new Headers(init?.headers).get('range');
        if (!header || mode === 'ignores-range') {
          // the size lookup succeeds (Content-Length of the whole file); Range reads do not
          return new Response(bytes, {
            status: 200,
            headers: { 'content-length': String(bytes.length) },
          });
        }
        // a partial response whose Content-Range the browser may not read
        const match = /^bytes=(\d+)-(\d+)$/.exec(header)!;
        return new Response(bytes.subarray(Number(match[1]), Number(match[2]) + 1), {
          status: 206,
        });
      });
      const source = createEpisodeSetDataSource({
        fps: info.fps,
        features: info.features,
        recordings: [await unsized('a')],
        episodes: [{ recordingId: 'a', task: 'pick', fromRow: 2, toRow: 5, fromS: 0.2, toS: 0.5 }],
      });
      const loader = new LeRobotDataLoader(source);
      await loader.initialize();
      const columns = await loader.loadAllNumericalData(0, ['index']);
      expect(Array.from(columns.index.values), mode).toEqual([2, 3, 4]);
      expect(
        warn.mock.calls.some(([message]) =>
          String(message).includes(mode === 'ignores-range' ? 'range reads of' : 'no size for'),
        ),
        mode,
      ).toBe(true);
      warn.mockClear();
      await loader.dispose();
    }
    warn.mockRestore();
  });

  it('retries a transient Range failure and never reads the data file whole because of it', async () => {
    const saved = RANGE_RETRY_POLICY.delaysMs;
    RANGE_RETRY_POLICY.delaysMs = [1, 1, 1];
    const unsized = async (id: string) => {
      const rec = await recording(id);
      rec.files = rec.files.map((file) => ({ ...file, sizeBytes: null }));
      return rec;
    };
    const isData = (url: string) => url.includes('/data/');
    // failures of data-file requests to inject: 'network' throws, a number answers that status
    let failures: Array<'network' | number> = [];
    const wholeReads: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requested.push(url);
      const logicalPath = new URL(url).pathname.split('/').slice(2).join('/');
      const bytes = await fs.readFile(path.join(fixture, fixturePath(logicalPath)));
      const header = new Headers(init?.headers).get('range');
      if (!header) {
        if (isData(url)) wholeReads.push(url);
        return new Response(bytes, { status: 200 });
      }
      if (isData(url) && failures.length > 0) {
        const failure = failures.shift()!;
        if (failure === 'network') throw new TypeError('Failed to fetch');
        return new Response('busy', { status: failure });
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(header)!;
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.length - 1);
      return new Response(bytes.subarray(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
      });
    });
    const open = async () => {
      const source = createEpisodeSetDataSource({
        fps: info.fps,
        features: info.features,
        recordings: [await unsized('a')],
        episodes: [{ recordingId: 'a', task: 'pick', fromRow: 2, toRow: 5, fromS: 0.2, toS: 0.5 }],
      });
      const loader = new LeRobotDataLoader(source);
      await loader.initialize();
      return loader;
    };
    try {
      // a blip on the size lookup and on the first ranged read: retried, read by Range
      failures = ['network', 503, 'network'];
      let loader = await open();
      const columns = await loader.loadAllNumericalData(0, ['index']);
      expect(Array.from(columns.index.values)).toEqual([2, 3, 4]);
      expect(failures).toEqual([]);
      expect(wholeReads).toEqual([]);
      await loader.dispose();

      // a failure that outlasts the retries: the load fails, still nothing read whole
      failures = Array.from({ length: 20 }, () => 500);
      loader = await open();
      await expect(loader.loadAllNumericalData(0, ['index'])).rejects.toThrow();
      expect(wholeReads).toEqual([]);
      // and the file is not switched to whole reads: once the store recovers, Range again
      failures = [];
      const again = await loader.loadAllNumericalData(0, ['index']);
      expect(Array.from(again.index.values)).toEqual([2, 3, 4]);
      expect(wholeReads).toEqual([]);
      await loader.dispose();
    } finally {
      RANGE_RETRY_POLICY.delaysMs = saved;
    }
  });

  it('refuses a recording that is not a single-file tree', async () => {
    const twoFiles = await recording('a');
    twoFiles.files.push({
      ...twoFiles.files[1]!,
      logicalPath: 'data/chunk-000/file-001.parquet',
    });
    expect(() =>
      createEpisodeSetDataSource({
        fps: 10,
        features: info.features,
        recordings: [twoFiles],
        episodes: [],
      }),
    ).toThrow(/2 data files/);
  });

  it('refuses an episode of an unknown recording or with an empty range', async () => {
    const base = { fps: 10, features: info.features, recordings: [await recording('a')] };
    expect(() =>
      createEpisodeSetDataSource({
        ...base,
        episodes: [{ recordingId: 'x', task: 't', fromRow: 0, toRow: 1, fromS: 0, toS: 0.1 }],
      }),
    ).toThrow(/unknown recording/);
    expect(() =>
      createEpisodeSetDataSource({
        ...base,
        episodes: [{ recordingId: 'a', task: 't', fromRow: 3, toRow: 3, fromS: 0, toS: 0 }],
      }),
    ).toThrow(/empty or negative/);
  });
});
