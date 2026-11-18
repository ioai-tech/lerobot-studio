import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const parses = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const parquet = await import('./helpers/parquet');
  return {
    createParquetWorker: () => ({
      readParquet: async (buffer: ArrayBuffer, columns?: string[]) => {
        parses.count += 1;
        return parquet.readParquetToIPC(new Uint8Array(buffer), columns);
      },
      readNumericColumns: async (buffer: ArrayBuffer, columns: string[], s: number, e: number) =>
        parquet.readNumericColumns(new Uint8Array(buffer), columns, s, e),
      readFeatureData: async (buffer: ArrayBuffer, columns: string[], s: number, e: number) =>
        parquet.readFeatureData(new Uint8Array(buffer), columns, s, e),
      readNumericColumnsRanged: parquet.readNumericColumnsRanged,
      readFeatureDataRanged: parquet.readFeatureDataRanged,
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import { LeRobotDataLoader } from '@/platform';
import { LocalFsDataSource } from './helpers/localFsDataSource';

const here = path.dirname(fileURLToPath(import.meta.url));
const V3 = path.join(here, 'fixtures/datasets/lerobotv3');
const EPISODES = 'meta/episodes/chunk-000/file-000.parquet';
const TASKS = 'meta/tasks.parquet';

/** A slow link: every byte read takes 50 ms and is logged when it starts and ends. */
class SlowSource extends LocalFsDataSource {
  readonly log: string[] = [];
  readonly reads = new Map<string, number>();
  constructor(private readonly listed: boolean) {
    super(V3);
    if (!listed) Object.defineProperty(this, 'listPaths', { value: undefined });
  }
  override async readBytes(relativePath: string) {
    this.reads.set(relativePath, (this.reads.get(relativePath) ?? 0) + 1);
    this.log.push(`start ${relativePath}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.log.push(`end ${relativePath}`);
    return super.readBytes(relativePath);
  }
  async listPaths(): Promise<string[]> {
    return [EPISODES, TASKS, 'meta/info.json', 'data/chunk-000/file-000.parquet'];
  }
}

describe('metadata loading', () => {
  for (const listed of [true, false]) {
    it(`requests the metadata files together, each once (${listed ? 'listed' : 'probed'} paths)`, async () => {
      const source = new SlowSource(listed);
      parses.count = 0;
      const loader = new LeRobotDataLoader(source);
      await loader.initialize();
      // No waterfall: tasks are requested before the episodes have arrived.
      expect(source.log.indexOf(`start ${TASKS}`)).toBeGreaterThanOrEqual(0);
      expect(source.log.indexOf(`start ${TASKS}`)).toBeLessThan(
        source.log.indexOf(`end ${EPISODES}`),
      );
      // Each file is downloaded and parsed once (the validator and the
      // adapter share them).
      expect(source.reads.get(EPISODES)).toBe(1);
      expect(source.reads.get(TASKS)).toBe(1);
      expect(parses.count).toBe(2);
      expect(loader.getEpisodes().length).toBeGreaterThan(0);
      expect(Object.keys(loader.getTasks()).length).toBeGreaterThan(0);
    });
  }
});
