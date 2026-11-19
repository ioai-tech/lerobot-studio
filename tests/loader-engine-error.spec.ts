import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/workers/workerManager.ts', async () => {
  const { parquetEngineError } = await import('../src/core/workers/engineError');
  const unavailable = async () => {
    throw parquetEngineError('Failed to fetch WASM: 503');
  };
  return {
    createParquetWorker: () => ({
      readParquet: unavailable,
      readNumericColumns: unavailable,
      readFeatureData: unavailable,
      readNumericColumnsRanged: unavailable,
      readFeatureDataRanged: unavailable,
      clearCache: async () => undefined,
    }),
    terminateWorker: () => undefined,
  };
});

import { LeRobotDataLoader } from '@/platform';
import { LocalFsDataSource } from './helpers/localFsDataSource';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('an unavailable Parquet reader', () => {
  it('is reported as itself, not as an invalid episodes file', async () => {
    const loader = new LeRobotDataLoader(
      new LocalFsDataSource(path.join(here, 'fixtures/datasets/lerobotv3')),
    );
    const failure = loader.initialize();
    await expect(failure).rejects.toThrow(
      'PARQUET_ENGINE_UNAVAILABLE: the Parquet reader could not be loaded (Failed to fetch WASM: 503)',
    );
    await expect(failure).rejects.not.toThrow('could not be parsed as Parquet');
  });
});
