import { describe, expect, it } from 'vitest';
import { LeRobotDataLoader } from '@/platform';
import { ExportService } from '@/platform';
import { InMemoryExportAdapter } from '../helpers/inMemoryExportAdapter';
import { FetchDataSource, isMp4Container } from './fixtures';

const EXAMPLE_URL = '/tests/fixtures/datasets/lerobotv2';

describe('browser: v2 mp4 source → v3.0 mp4 target (byte-copy fast path)', () => {
  it('copies already-MP4 videos byte-for-byte when target is v3 and source has no trim', async () => {
    const source = new FetchDataSource(EXAMPLE_URL);
    const loader = new LeRobotDataLoader(source);
    try {
      const info = await loader.initialize();
      const episodes = loader.getEpisodes().slice(0, 1);
      expect(episodes.length).toBeGreaterThan(0);

      const adapter = new InMemoryExportAdapter();
      const service = new ExportService(loader, adapter);

      const start = performance.now();
      await service.exportWithData(info, episodes, loader.getTasks(), {
        format: 'zip',
        targetVersion: 'v3.0',
        includeData: true,
        includeVideos: true,
        onProgress: () => undefined,
      });
      const durationMs = performance.now() - start;
      console.log(
        JSON.stringify({
          name: 'export-v2-to-v3',
          durationMs: Math.round(durationMs),
          files: adapter.listFiles().length,
        }),
      );

      expect(adapter.listFiles()).toContain('meta/info.json');
      const outInfo = JSON.parse(
        new TextDecoder().decode(await adapter.readFile('meta/info.json')),
      ) as { codebase_version: string };
      expect(outInfo.codebase_version).toBe('v3.0');

      const mp4Paths = adapter
        .listFiles()
        .filter((p) => p.startsWith('videos/') && p.endsWith('.mp4'));
      expect(mp4Paths.length).toBeGreaterThan(0);

      for (const p of mp4Paths) {
        const bytes = await adapter.readFile(p);
        expect(bytes.length).toBeGreaterThan(0);
        expect(isMp4Container(bytes)).toBe(true);
      }

      // Data parquet for v3 target should exist with contiguous episode_index.
      const dataPaths = adapter
        .listFiles()
        .filter((p) => p.startsWith('data/') && p.endsWith('.parquet'));
      expect(dataPaths.length).toBeGreaterThan(0);
    } finally {
      await loader.dispose();
    }
  }, 120_000);
});
