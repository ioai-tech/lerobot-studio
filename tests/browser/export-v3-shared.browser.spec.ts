import { describe, expect, it } from 'vitest';
import { tableFromIPC } from 'apache-arrow';
import { ExportService, LeRobotDataLoader } from '@/platform';
import { getParquetWasm } from '../../src/platform/export/parquetWasmLoader';
import { InMemoryExportAdapter } from '../helpers/inMemoryExportAdapter';
import { FetchDataSource, isMp4Container } from './fixtures';

describe('browser: same-version v3 export after deletion', () => {
  it.each([false, true])(
    'roundtrips video and data with compactVideos=%s',
    async (compactVideos) => {
      const source = new FetchDataSource('/tests/fixtures/datasets/lerobotv3');
      const loader = new LeRobotDataLoader(source);
      try {
        const info = await loader.initialize();
        const kept = loader.getEpisodes().slice(1);
        const key = 'observation.images.cam';
        const originalVideo = await source.readBytes(
          loader.getEpisodeVideoPath(kept[0].episode_index, key)!.path,
        );
        const adapter = new InMemoryExportAdapter();
        await new ExportService(loader, adapter).exportWithData(info, kept, loader.getTasks(), {
          format: 'zip',
          targetVersion: 'v3.0',
          includeData: true,
          includeVideos: true,
          compactVideos,
        });
        const outputInfo = JSON.parse(
          new TextDecoder().decode(await adapter.readFile('meta/info.json')),
        );
        expect(outputInfo.total_episodes).toBe(1);
        expect(outputInfo.splits).toEqual({ train: '0:1' });
        const video = await adapter.readFile(`videos/${key}/chunk-000/file-000.mp4`);
        expect(isMp4Container(video)).toBe(true);
        if (!compactVideos) expect(video).toEqual(originalVideo);
        const wasm = await getParquetWasm();
        const data = tableFromIPC(
          wasm
            .readParquet(await adapter.readFile('data/chunk-000/file-000.parquet'))
            .intoIPCStream(),
        );
        expect(data.numRows).toBe(kept[0].length);
        expect(Array.from(data.getChild('episode_index')!.toArray(), Number)).toEqual(
          Array(kept[0].length).fill(0),
        );
        const metadata = tableFromIPC(
          wasm
            .readParquet(await adapter.readFile('meta/episodes/chunk-000/file-000.parquet'))
            .intoIPCStream(),
        );
        expect(Number(metadata.getChild(`videos/${key}/to_timestamp`)!.get(0))).toBeGreaterThan(0);
      } finally {
        await loader.dispose();
      }
    },
  );
});
