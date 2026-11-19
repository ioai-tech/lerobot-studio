import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

// A guarded call's result must be collectable once the caller drops it, while
// the worker lives on: nothing that lives as long as the worker may hold it.

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

class IdleWorker extends EventTarget {
  postMessage() {}
  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('comlink');
  vi.resetModules();
});

it('lets each call result be collected while a healthy worker stays alive', async () => {
  vi.stubGlobal('Worker', IdleWorker);
  vi.stubGlobal('location', { href: 'https://host.test/' });
  // The remote answers every call with 1 MiB, as a Parquet read would.
  vi.doMock('comlink', () => ({
    wrap: () =>
      new Proxy(
        {},
        {
          get: (_target, property) =>
            property === 'then' ? undefined : async () => new Uint8Array(1 << 20),
        },
      ),
    releaseProxy: Symbol('releaseProxy'),
  }));
  const { createParquetWorker } = await import('../src/platform/workers/workerManager');
  const remote = createParquetWorker() as unknown as {
    readParquet: () => Promise<Uint8Array>;
  };

  const CALLS = 100;
  let collected = 0;
  const registry = new FinalizationRegistry(() => {
    collected += 1;
  });
  for (let i = 0; i < CALLS; i += 1) {
    registry.register(await remote.readParquet(), i);
  }
  for (let round = 0; round < 10 && collected < CALLS * 0.9; round += 1) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(collected).toBeGreaterThan(CALLS * 0.9);
  expect(remote).toBeDefined(); // the worker (and its remote) are still alive
}, 60_000);
