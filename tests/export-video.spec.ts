import { describe, expect, it, vi } from 'vitest';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import type { LeRobotDataLoader } from '@/platform';
import { exportVideosByTarget } from '../src/platform/export/VideoExporter';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';

function mp4LikeBytes(marker: number): Uint8Array {
  return new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, marker, 0, 0, 0]);
}

describe('v3 video file rolling', () => {
  it('copies each referenced shared MP4 once and retains nonzero timestamps after deletion', async () => {
    const all = [0, 1, 2, 3, 4].map((episode_index) => ({
      episode_index,
      length: 20,
      tasks: ['pick'],
    })) as EpisodeMetadata[];
    const kept = [all[1], all[2], all[4]];
    const read = vi.fn(async () => mp4LikeBytes(42));
    const loader = {
      getEpisodeVideoPath: (index: number, key: string) => ({
        path: `${key}/${index === 3 ? 'deleted-only' : index === 4 ? 'last' : 'shared'}.mp4`,
        fromSec: index === 4 ? 0 : index * 2,
        toSec: index === 4 ? 2 : index * 2 + 2,
      }),
      readFileBytes: read,
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v3.0',
      chunks_size: 1,
      features: { front: { dtype: 'video' }, wrist: { dtype: 'video' } },
    } as unknown as LeRobotInfo;
    const adapter = new InMemoryExportAdapter();
    const offsets = await exportVideosByTarget(loader, info, kept, 'v3.0', adapter);
    expect(read).toHaveBeenCalledTimes(4);
    expect(read.mock.calls.flat()).not.toContain('front/deleted-only.mp4');
    expect(adapter.listFiles()).toHaveLength(4);
    expect(offsets?.has(0)).toBe(false);
    expect(offsets?.has(3)).toBe(false);
    expect(offsets?.get(1)?.front).toEqual({
      chunk_index: 0,
      file_index: 0,
      from_timestamp: 2,
      to_timestamp: 4,
    });
    expect(offsets?.get(2)?.front).toEqual({
      chunk_index: 0,
      file_index: 0,
      from_timestamp: 4,
      to_timestamp: 6,
    });
    expect(offsets?.get(4)?.wrist).toEqual({
      chunk_index: 1,
      file_index: 0,
      from_timestamp: 0,
      to_timestamp: 2,
    });
    for (const path of adapter.listFiles())
      expect(await adapter.readFile(path)).toEqual(mp4LikeBytes(42));
    await expect(
      exportVideosByTarget(loader, info, kept, 'v3.0', adapter, undefined, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('rejects invalid shared-video ranges and invalid MP4s', async () => {
    const episode = [{ episode_index: 0, length: 20, tasks: ['pick'] }] as EpisodeMetadata[];
    const info = {
      codebase_version: 'v3.0',
      features: { front: { dtype: 'video' } },
    } as unknown as LeRobotInfo;
    for (const range of [
      null,
      { path: 'x', fromSec: -1, toSec: 2 },
      { path: 'x', fromSec: 1, toSec: 1 },
      { path: 'x', fromSec: NaN, toSec: 2 },
    ]) {
      const loader = { getEpisodeVideoPath: () => range } as unknown as LeRobotDataLoader;
      await expect(
        exportVideosByTarget(loader, info, episode, 'v3.0', new InMemoryExportAdapter()),
      ).rejects.toThrow(/invalid video range/i);
    }
    const loader = {
      getEpisodeVideoPath: () => ({ path: 'x', fromSec: 0, toSec: 2 }),
      readFileBytes: async () => new Uint8Array(12),
    } as unknown as LeRobotDataLoader;
    await expect(
      exportVideosByTarget(loader, info, episode, 'v3.0', new InMemoryExportAdapter()),
    ).rejects.toThrow(/Invalid source MP4/);
  });
  it('uses one lossless episode file and rolls chunks by file count', async () => {
    const episodes = [10, 20, 30].map((episode_index) => ({
      episode_index,
      length: 1,
      tasks: ['pick'],
      task_index: 0,
    })) as EpisodeMetadata[];
    const bytes = new Map(
      episodes.map((episode, index) => [`ep-${episode.episode_index}`, mp4LikeBytes(index)]),
    );
    const loader = {
      getEpisodeVideoPath: (episodeIndex: number) => ({
        path: `ep-${episodeIndex}`,
        fromSec: 0,
        toSec: 0,
      }),
      readFileBytes: async (path: string) => bytes.get(path)!,
    } as unknown as LeRobotDataLoader;
    const info = {
      codebase_version: 'v2.1',
      chunks_size: 2,
      video_files_size_in_mb: 0.000001,
      features: { camera: { dtype: 'video', shape: [3, 1, 1], names: null } },
    } as unknown as LeRobotInfo;
    const adapter = new InMemoryExportAdapter();

    const offsets = await exportVideosByTarget(loader, info, episodes, 'v3.0', adapter);

    expect(adapter.listFiles().sort()).toEqual([
      'videos/camera/chunk-000/file-000.mp4',
      'videos/camera/chunk-000/file-001.mp4',
      'videos/camera/chunk-001/file-000.mp4',
    ]);
    expect(offsets?.get(10)?.camera).toMatchObject({ chunk_index: 0, file_index: 0 });
    expect(offsets?.get(20)?.camera).toMatchObject({ chunk_index: 0, file_index: 1 });
    expect(offsets?.get(30)?.camera).toMatchObject({ chunk_index: 1, file_index: 0 });
  });
});
