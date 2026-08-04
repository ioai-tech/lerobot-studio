import { describe, expect, it } from 'vitest';
import type { LeRobotInfo, EpisodeMetadata } from '@/core';
import type { LeRobotDataLoader } from '@/platform';
import { exportVideosByTarget } from '../src/platform/export/VideoExporter';
import { InMemoryExportAdapter } from './helpers/inMemoryExportAdapter';

function mp4LikeBytes(marker: number): Uint8Array {
  return new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, marker, 0, 0, 0]);
}

describe('v3 video file rolling', () => {
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
      codebase_version: 'v3.0',
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
