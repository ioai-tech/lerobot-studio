import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const { readParquetToIPC, readNumericColumns, readFeatureData } =
    await import('./helpers/parquet');
  return {
    createParquetWorker: () => ({
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
import type { ProgressHandler } from '@/platform';
import { LocalFsDataSource } from './helpers/localFsDataSource';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/datasets');

/**
 * A host-scoped dataset: only the files of `present` episodes exist (as when a
 * host signs one episode of a multi-episode upload), metadata lists them all.
 */
class PartialSource extends LocalFsDataSource {
  readonly episodeScope?: readonly number[];
  readonly reads: string[] = [];
  constructor(
    root: string,
    private readonly hidden: RegExp,
    scope?: number[],
  ) {
    super(root);
    if (scope) this.episodeScope = scope;
  }
  override async exists(p: string) {
    return this.hidden.test(p) ? false : super.exists(p);
  }
  override async readBytes(p: string, onProgress?: ProgressHandler) {
    if (this.hidden.test(p)) throw new Error(`hidden: ${p}`);
    this.reads.push(p);
    return super.readBytes(p, onProgress);
  }
  override async readText(p: string, onProgress?: ProgressHandler) {
    if (this.hidden.test(p)) throw new Error(`hidden: ${p}`);
    return super.readText(p, onProgress);
  }
}

describe('host-given episode scope', () => {
  it('v2.1 without a scope fails a dataset that carries one episode (old behaviour)', async () => {
    const source = new PartialSource(path.join(fixtures, 'lerobotv2'), /episode_000000/);
    const loader = new LeRobotDataLoader(source);
    await loader.initialize();
    const codes = loader.getValidationReport()!.items.map((item) => `${item.level}:${item.code}`);
    expect(codes).toContain('error:EPISODE_DATA_MISSING');
  });

  it('v2.1 lists only scoped episodes and marks the rest not evaluated', async () => {
    const source = new PartialSource(path.join(fixtures, 'lerobotv2'), /episode_000000/, [1]);
    const loader = new LeRobotDataLoader(source);
    await loader.initialize();

    expect(loader.getEpisodes().map((episode) => episode.episode_index)).toEqual([1]);
    const report = loader.getValidationReport()!;
    expect(report.hasError).toBe(false);
    expect(report.items).toContainEqual(
      expect.objectContaining({
        level: 'not_evaluated',
        code: 'EPISODES_OUT_OF_SCOPE',
        messageValues: { count: 1 },
      }),
    );
    const data = await loader.loadAllNumericalData(1, ['observation.state']);
    expect(data['observation.state']!.rows).toBe(3);
    expect(source.reads.every((p) => !p.includes('episode_000000'))).toBe(true);
  });

  it('v3 lists only scoped episodes and checks the first scoped episode files', async () => {
    const source = new PartialSource(path.join(fixtures, 'lerobotv3'), /file-000\.mp4$/, [1]);
    const loader = new LeRobotDataLoader(source);
    await loader.initialize();

    expect(loader.getEpisodes().map((episode) => episode.episode_index)).toEqual([1]);
    const report = loader.getValidationReport()!;
    expect(report.items).toContainEqual(
      expect.objectContaining({ level: 'not_evaluated', code: 'EPISODES_OUT_OF_SCOPE' }),
    );
    expect(report.items.filter((item) => item.code === 'VIDEO_FILE_MISSING')).toEqual([]);
    expect(report.hasError).toBe(false);
  });
});
