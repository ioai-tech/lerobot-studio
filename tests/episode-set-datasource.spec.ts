import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const {
    readParquetToIPC,
    readNumericColumns,
    readFeatureData,
    readNumericColumnsRanged,
    readFeatureDataRanged,
  } = await import('./helpers/parquet');
  return {
    createParquetWorker: () => ({
      readNumericColumnsRanged,
      readFeatureDataRanged,
      readParquet: async (buffer: ArrayBuffer, columns?: string[]) =>
        readParquetToIPC(new Uint8Array(buffer), columns),
      readNumericColumns: async (buffer: ArrayBuffer, columns: string[], s: number, e: number) =>
        readNumericColumns(new Uint8Array(buffer), columns, s, e),
      readFeatureData: async (buffer: ArrayBuffer, columns: string[], s: number, e: number) =>
        readFeatureData(new Uint8Array(buffer), columns, s, e),
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import { LeRobotDataLoader } from '@/platform';
import {
  createEpisodeSetDataSource,
  EpisodeSetError,
  type EpisodeSetManifest,
  type EpisodeSetOptions,
  type EpisodeSetResolvedRecording,
  type RemoteFileEntry,
} from '../src/react/public-api';
import { oneEpisodeFrameColumns, writeParquetBytes } from './helpers/writeParquet';

const FPS = 30;
const FEATURES = {
  timestamp: { dtype: 'float32', shape: [1], names: null },
  frame_index: { dtype: 'int64', shape: [1], names: null },
  index: { dtype: 'int64', shape: [1], names: null },
  episode_index: { dtype: 'int64', shape: [1], names: null },
  'observation.state': { dtype: 'float32', shape: [1], names: ['joint'] },
  action: { dtype: 'float32', shape: [1], names: ['joint'] },
  'observation.images.cam': {
    dtype: 'video',
    shape: [48, 64, 3],
    names: ['height', 'width', 'channels'],
    info: { 'video.codec': 'h264' },
  },
};

let parquetByRecording: Map<string, Uint8Array>;
let signature = 1;

beforeAll(async () => {
  parquetByRecording = new Map([
    ['rec-a', await writeParquetBytes(oneEpisodeFrameColumns(900, FPS, 0))],
    ['rec-b', await writeParquetBytes(oneEpisodeFrameColumns(120, FPS, 10_000))],
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  signature = 1;
});

function filesFor(id: string): RemoteFileEntry[] {
  return [
    {
      logicalPath: 'meta/info.json',
      presignedUrl: `https://store.test/${id}/info.json?sig=${signature}`,
    },
    {
      logicalPath: 'data/chunk-000/file-000.parquet',
      presignedUrl: `https://store.test/${id}/data.parquet?sig=${signature}`,
    },
    {
      logicalPath: 'videos/observation.images.cam/chunk-000/file-000.mp4',
      presignedUrl: `https://store.test/${id}/cam.mp4?sig=${signature}`,
    },
  ];
}

function stubStore() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.searchParams.get('sig') !== String(signature)) {
      return new Response('expired', { status: 403 });
    }
    const id = url.pathname.split('/')[1]!;
    const bytes = parquetByRecording.get(id) ?? parquetByRecording.get('rec-b')!;
    return new Response(bytes, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

function resolver() {
  const calls: string[][] = [];
  const resolve = vi.fn(async (ids: string[]): Promise<EpisodeSetResolvedRecording[]> => {
    calls.push([...ids]);
    return ids.map((id) => ({ id, files: filesFor(id) }));
  });
  return { resolve, calls };
}

function manyRecordings(count: number): EpisodeSetManifest {
  return {
    fps: FPS,
    features: FEATURES,
    robotType: 'test',
    recordings: Array.from({ length: count }, (_, i) => ({ id: `r${i}` })),
    episodes: Array.from({ length: count }, (_, i) => ({
      recordingId: `r${i}`,
      task: i % 2 ? 'pick' : 'place',
      fromRow: 0,
      toRow: 120,
      fromS: 0,
      toS: 4,
      meta: { split: i % 10 === 0 ? 'val' : 'train', score: i },
    })),
  };
}

async function openLoader(manifest: EpisodeSetManifest, options: EpisodeSetOptions) {
  const source = createEpisodeSetDataSource(manifest, options);
  const loader = new LeRobotDataLoader(source);
  await loader.initialize();
  return { source, loader };
}

describe('episode set data source', () => {
  it('opens 2,000 recordings without resolving any', async () => {
    const fetchImpl = stubStore();
    const { resolve } = resolver();
    const { loader } = await openLoader(manyRecordings(2_000), { resolve });

    expect(resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    const episodes = loader.getEpisodes();
    expect(episodes).toHaveLength(2_000);
    expect(episodes[10]).toMatchObject({ episode_index: 10, split: 'val', score: 10 });
    expect(episodes[11]!.tasks).toEqual(['pick']);
    expect(loader.getValidationReport()?.hasError).toBe(false);
  });

  it('resolves episode k once, batched with the next two recordings', async () => {
    stubStore();
    const { resolve, calls } = resolver();
    const { loader } = await openLoader(manyRecordings(50), { resolve });

    await loader.loadAllNumericalData(7, ['observation.state']);
    await loader.loadAllNumericalData(7, ['observation.state']);
    expect(loader.getEpisodeVideoPath(7, 'observation.images.cam')?.path).toBe(
      'videos/observation.images.cam/chunk-000/file-007.mp4',
    );
    await loader.getFileUrl('videos/observation.images.cam/chunk-000/file-007.mp4');
    expect(calls).toEqual([['r7', 'r8', 'r9']]);

    // The prefetched recording needs no further resolve.
    await loader.loadAllNumericalData(8, ['observation.state']);
    expect(calls).toHaveLength(1);
    await loader.loadAllNumericalData(10, ['observation.state']);
    expect(calls).toEqual([
      ['r7', 'r8', 'r9'],
      ['r10', 'r11', 'r12'],
    ]);
  });

  it('maps episodes that do not start at row 0, two per recording', async () => {
    stubStore();
    const { resolve } = resolver();
    const manifest: EpisodeSetManifest = {
      fps: FPS,
      features: FEATURES,
      recordings: [{ id: 'rec-a' }, { id: 'rec-b' }],
      episodes: [
        { recordingId: 'rec-a', task: 'first', fromRow: 300, toRow: 600, fromS: 10, toS: 20 },
        {
          recordingId: 'rec-a',
          task: 'second',
          fromRow: 700,
          toRow: 900,
          fromS: 700 / 30,
          toS: 30,
        },
        { recordingId: 'rec-b', task: 'third', fromRow: 0, toRow: 120, fromS: 0, toS: 4 },
      ],
    };
    const { loader } = await openLoader(manifest, { resolve });

    const first = await loader.loadAllNumericalData(0, ['observation.state']);
    expect(first['observation.state']!.rows).toBe(300);
    expect(first['observation.state']!.values[0]).toBe(300);
    expect(first['observation.state']!.values[299]).toBe(599);

    const second = await loader.loadAllNumericalData(1, ['observation.state']);
    expect(second['observation.state']!.rows).toBe(200);
    expect(second['observation.state']!.values[0]).toBe(700);

    const third = await loader.loadAllNumericalData(2, ['observation.state']);
    expect(third['observation.state']!.values[0]).toBe(10_000);

    expect(loader.getEpisodeVideoPath(1, 'observation.images.cam')).toMatchObject({
      path: 'videos/observation.images.cam/chunk-000/file-000.mp4',
      fromSec: 700 / 30,
      toSec: 30,
    });
  });

  it('refresh re-resolves only resolved recordings and swaps URLs', async () => {
    stubStore();
    const { resolve } = resolver();
    const refresh = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, files: filesFor(id) })));
    const { source, loader } = await openLoader(manyRecordings(20), { resolve, refresh });
    await loader.loadAllNumericalData(3, ['observation.state']);
    const changed: string[][] = [];
    loader.subscribeUrlChanges((paths) => changed.push([...paths]));

    signature += 1; // every URL issued so far is now expired
    await loader.releaseParsedCaches();
    loader.clearCache();
    await loader.loadAllNumericalData(4, ['observation.state']);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]![0].sort()).toEqual(['r3', 'r4', 'r5']);
    expect(changed[0]).toContain('videos/observation.images.cam/chunk-000/file-003.mp4');
    await expect(source.getObjectUrl('data/chunk-000/file-004.parquet')).resolves.toContain(
      `sig=${signature}`,
    );
  });

  it('a resolver error fails only that episode, with a typed error', async () => {
    stubStore();
    const resolve = vi.fn(async (ids: string[]) => {
      if (ids.includes('r2')) throw new Error('signing service down');
      return ids.map((id) => ({ id, files: filesFor(id) }));
    });
    const { loader } = await openLoader(manyRecordings(10), { resolve });

    const error = await loader
      .loadAllNumericalData(2, ['observation.state'])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EpisodeSetError);
    expect(error).toMatchObject({ code: 'RECORDING_RESOLVE_FAILED', recordingId: 'r2' });
    expect((error as Error).message).toContain('r2');

    const other = await loader.loadAllNumericalData(5, ['observation.state']);
    expect(other['observation.state']!.rows).toBe(120);
  });

  it('a failing prefetch id never fails the selected episode, nor is batched again', async () => {
    stubStore();
    const calls: string[][] = [];
    const resolve = vi.fn(async (ids: string[]) => {
      calls.push([...ids]);
      if (ids.includes('r2')) throw new Error('signing service down for r2');
      return ids.map((id) => ({ id, files: filesFor(id) }));
    });
    const { loader } = await openLoader(manyRecordings(10), { resolve });

    const first = await loader.loadAllNumericalData(0, ['observation.state']);
    expect(first['observation.state']!.rows).toBe(120);
    const second = await loader.loadAllNumericalData(1, ['observation.state']);
    expect(second['observation.state']!.rows).toBe(120);
    // r1 was in the failed batch, so it resolves now, and r2 is never batched again.
    expect(calls).toEqual([['r0', 'r1', 'r2'], ['r0'], ['r1', 'r3', 'r4']]);
    const error = await loader
      .loadAllNumericalData(2, ['observation.state'])
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'RECORDING_RESOLVE_FAILED', recordingId: 'r2' });
  });

  it("prefetches the recordings after the focused episode, not after its recording's first", async () => {
    stubStore();
    const { resolve, calls } = resolver();
    const order = ['r0', 'r1', 'r2', 'r0', 'r3', 'r4'];
    const manifest: EpisodeSetManifest = {
      fps: FPS,
      features: FEATURES,
      recordings: ['r0', 'r1', 'r2', 'r3', 'r4'].map((id) => ({ id })),
      episodes: order.map((recordingId, k) => ({
        recordingId,
        task: 'pick',
        fromRow: recordingId === 'r0' && k === 3 ? 120 : 0,
        toRow: recordingId === 'r0' && k === 3 ? 240 : 120,
        fromS: 0,
        toS: 4,
      })),
    };
    const { loader } = await openLoader(manifest, { resolve });
    await loader.loadAllNumericalData(3, ['observation.state']).catch(() => undefined);
    expect(calls[0]).toEqual(['r0', 'r3', 'r4']);
  });

  it('refuses recordings that are not one-episode v3 trees, naming them', async () => {
    stubStore();
    const resolve = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        files:
          id === 'r1'
            ? [
                ...filesFor(id),
                {
                  logicalPath: 'data/chunk-000/file-001.parquet',
                  presignedUrl: `https://store.test/${id}/data2.parquet?sig=1`,
                },
              ]
            : id === 'r2'
              ? filesFor(id).filter((file) => !file.logicalPath.startsWith('videos/'))
              : filesFor(id),
      })),
    );
    const { loader } = await openLoader(manyRecordings(6), { resolve });

    await expect(loader.loadAllNumericalData(1, ['observation.state'])).rejects.toMatchObject({
      code: 'RECORDING_LAYOUT_REFUSED',
      recordingId: 'r1',
    });
    await expect(loader.loadAllNumericalData(2, ['observation.state'])).rejects.toMatchObject({
      code: 'RECORDING_LAYOUT_REFUSED',
      recordingId: 'r2',
    });
    await expect(loader.loadAllNumericalData(0, ['observation.state'])).resolves.toBeTruthy();

    // Inline files are checked when the set is created.
    expect(() =>
      createEpisodeSetDataSource({
        ...manyRecordings(1),
        recordings: [{ id: 'r0', files: filesFor('r0').slice(0, 1) }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'RECORDING_LAYOUT_REFUSED', recordingId: 'r0' }),
    );
  });

  it('rejects invalid manifests with typed errors', () => {
    const base = manyRecordings(2);
    expect(() => createEpisodeSetDataSource(base)).toThrowError(
      expect.objectContaining({ code: 'MANIFEST_INVALID', recordingId: 'r0' }),
    );
    const resolve = async () => [];
    expect(() =>
      createEpisodeSetDataSource(
        { ...base, episodes: [{ ...base.episodes[0]!, fromRow: 10, toRow: 10 }] },
        { resolve },
      ),
    ).toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
    expect(() =>
      createEpisodeSetDataSource(
        { ...base, episodes: [{ ...base.episodes[0]!, meta: { length: 3 } }] },
        { resolve },
      ),
    ).toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
  });

  it('uses a host preview copy for a camera when the recording has one', async () => {
    stubStore();
    const resolve = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        files: [
          ...filesFor(id),
          {
            logicalPath: 'preview/observation.images.cam.mp4',
            presignedUrl: `https://store.test/${id}/preview.mp4?sig=1`,
          },
        ],
      })),
    );
    const manifest = manyRecordings(2);
    manifest.recordings[1]!.previewVideoPath = null;
    const source = createEpisodeSetDataSource(manifest, {
      resolve,
      previewVideoPath: 'preview/{video_key}.mp4',
    });
    await expect(
      source.getObjectUrl('videos/observation.images.cam/chunk-000/file-000.mp4'),
    ).resolves.toBe('https://store.test/r0/preview.mp4?sig=1');
    await expect(
      source.getObjectUrl('videos/observation.images.cam/chunk-000/file-001.mp4'),
    ).resolves.toBe('https://store.test/r1/cam.mp4?sig=1');
  });
});
