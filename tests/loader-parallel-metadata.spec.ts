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

describe('metadata reads in flight', () => {
  it('opens at most six listed metadata file reads at once', async () => {
    const shards = Array.from(
      { length: 20 },
      (_, index) => `meta/episodes/chunk-000/file-${String(index + 1).padStart(3, '0')}.parquet`,
    );
    let inFlight = 0;
    let most = 0;
    class ManyShards extends LocalFsDataSource {
      constructor() {
        super(V3);
      }
      override async readBytes(relativePath: string) {
        // The listed (prefetched) files; `meta/subtasks.parquet` is not listed here.
        if (!relativePath.startsWith('meta/episodes/') && relativePath !== TASKS) {
          return super.readBytes(relativePath);
        }
        inFlight += 1;
        most = Math.max(most, inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 20));
          // Every extra shard is a copy of the real one.
          return await super.readBytes(shards.includes(relativePath) ? EPISODES : relativePath);
        } finally {
          inFlight -= 1;
        }
      }
      async listPaths(): Promise<string[]> {
        return [EPISODES, ...shards, TASKS, 'meta/info.json'];
      }
    }
    const source = new ManyShards();
    await new LeRobotDataLoader(source).initialize();
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(6);
  });

  it('frees the slot of a read whose host readBytes throws, so the reads behind it still start', async () => {
    const shards = Array.from(
      { length: 20 },
      (_, index) => `meta/episodes/chunk-000/file-${String(index + 1).padStart(3, '0')}.parquet`,
    );
    const started = new Set<string>();
    class ThrowingHost extends LocalFsDataSource {
      constructor() {
        super(V3);
      }
      // Not async: the first shards throw at once, as a host's own code might.
      override readBytes(relativePath: string) {
        if (shards.includes(relativePath)) {
          started.add(relativePath);
          if (shards.indexOf(relativePath) < 8) throw new Error(`host bug on ${relativePath}`);
          return super.readBytes(EPISODES);
        }
        return super.readBytes(relativePath);
      }
      async listPaths(): Promise<string[]> {
        return [EPISODES, ...shards, TASKS, 'meta/info.json'];
      }
    }
    const opened = new LeRobotDataLoader(new ThrowingHost()).initialize().catch(() => undefined);
    await Promise.race([opened, new Promise((resolve) => setTimeout(resolve, 3000))]);
    expect([...started].sort()).toEqual([...shards].sort());
  });
});
