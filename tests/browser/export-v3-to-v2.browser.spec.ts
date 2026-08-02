import { describe, expect, it } from 'vitest';
import { LeRobotDataLoader } from '@ioai/lerobot-studio-platform';
import { ExportService } from '@ioai/lerobot-studio-platform';
import { InMemoryExportAdapter } from '../helpers/inMemoryExportAdapter';
import { FetchDataSource, isMp4Container } from './fixtures';

// Vite dev-serves the workspace root, so `examples/...` is fetchable from
// `/examples/...`. See vite.config.ts fsAllow / server.fs.
const EXAMPLE_URL = '/tests/fixtures/datasets/lerobotv3';

describe('browser: v3 source → v2.1 target MP4 export', () => {
  it('produces MP4 videos with ftyp magic bytes and a contiguous v2 layout', async () => {
    const source = new FetchDataSource(EXAMPLE_URL);
    const loader = new LeRobotDataLoader(source);
    try {
      const info = await loader.initialize();
      const episodes = loader.getEpisodes().slice(0, 1); // 1 episode is enough to smoke-test transcoding.
      expect(episodes.length).toBeGreaterThan(0);

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
          name: 'export-v3-to-v2',
          durationMs: Math.round(durationMs),
          files: adapter.listFiles().length,
        }),
      );

      expect(adapter.listFiles()).toContain('meta/info.json');
      expect(adapter.listFiles()).toContain('meta/episodes.jsonl');
      const infoTxt = new TextDecoder().decode(await adapter.readFile('meta/info.json'));
      const outInfo = JSON.parse(infoTxt) as { codebase_version: string };
      expect(outInfo.codebase_version).toBe('v2.1');

      const mp4Paths = adapter
        .listFiles()
        .filter((p) => p.startsWith('videos/') && p.endsWith('.mp4'));
      expect(mp4Paths.length).toBeGreaterThan(0);

      for (const p of mp4Paths) {
        const bytes = await adapter.readFile(p);
        expect(bytes.length).toBeGreaterThan(0);
        expect(isMp4Container(bytes)).toBe(true);
      }
    } finally {
      await loader.dispose();
    }
  }, 180_000);
});
