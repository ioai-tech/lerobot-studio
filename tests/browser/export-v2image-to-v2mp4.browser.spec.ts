import { describe, expect, it } from 'vitest';
import { LeRobotDataLoader } from '@ioai/lerobot-studio-platform';
import { ExportService } from '@ioai/lerobot-studio-platform';
import type { LeRobotInfo } from '@ioai/lerobot-studio-core';
import { InMemoryExportAdapter } from '../helpers/inMemoryExportAdapter';
import { FetchDataSource, isMp4Container } from './fixtures';

const EXAMPLE_URL = '/tests/fixtures/datasets/lerobotv2-image';

describe('browser: v2 image source → v2.1 mp4 target', () => {
  it('encodes dtype: image features into MP4 and rewrites info.features[key].dtype to video', async () => {
    const source = new FetchDataSource(EXAMPLE_URL);
    const loader = new LeRobotDataLoader(source);
    try {
      const info: LeRobotInfo = await loader.initialize();
      const episodes = loader.getEpisodes().slice(0, 1);
      expect(episodes.length).toBeGreaterThan(0);

      const imageKeys = Object.entries(info.features)
        .filter(([, f]) => f?.dtype === 'image')
        .map(([k]) => k);
      expect(imageKeys.length).toBeGreaterThan(0);

      const adapter = new InMemoryExportAdapter();
      const service = new ExportService(loader, adapter);

      const start = performance.now();
      await service.exportWithData(info, episodes, loader.getTasks(), {
        format: 'zip',
        targetVersion: 'v2.1',
        includeData: true,
        includeVideos: true,
        onProgress: () => undefined,
      });
      const durationMs = performance.now() - start;
      console.log(
        JSON.stringify({
          name: 'export-v2image-to-v2mp4',
          durationMs: Math.round(durationMs),
          files: adapter.listFiles().length,
        }),
      );

      const outInfo = JSON.parse(
        new TextDecoder().decode(await adapter.readFile('meta/info.json')),
      ) as LeRobotInfo;
      for (const key of imageKeys) {
        expect(outInfo.features[key].dtype).toBe('video');
      }

      const mp4Paths = adapter
        .listFiles()
        .filter((p) => p.startsWith('videos/') && p.endsWith('.mp4'));
      expect(mp4Paths.length).toBeGreaterThanOrEqual(imageKeys.length);
      for (const p of mp4Paths) {
        const bytes = await adapter.readFile(p);
        expect(bytes.length).toBeGreaterThan(0);
        expect(isMp4Container(bytes)).toBe(true);
      }
    } finally {
      await loader.dispose();
    }
  }, 240_000);
});
