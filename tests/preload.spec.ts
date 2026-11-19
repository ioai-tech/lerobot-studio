import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Transform the module once up front: each test imports it fresh with its own
// mocks, and a cold first transform under coverage on a busy host can outlast
// one test's timeout (and leave a late import that skips the next test's mocks).
beforeAll(async () => {
  await import('../src/react/preload');
  vi.resetModules();
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../src/react/lazyChunks');
});

function mockChunks(overrides: Partial<Record<string, () => unknown>> = {}) {
  const prewarmParquetWorker = vi.fn();
  const chunks = {
    loadDockviewLayout: vi.fn(() => Promise.resolve({})),
    loadDataLoaderModule: vi.fn(() => Promise.resolve({})),
    loadWorkerManager: vi.fn(() => Promise.resolve({ prewarmParquetWorker })),
    ...overrides,
  };
  vi.doMock('../src/react/lazyChunks', () => chunks);
  return { chunks, prewarmParquetWorker };
}

describe('preloadLeRobotViewer', () => {
  it('does nothing outside a browser (server rendering)', async () => {
    const { chunks } = mockChunks();
    const { preloadLeRobotViewer } = await import('../src/react/preload');
    expect(() => preloadLeRobotViewer()).not.toThrow();
    expect(chunks.loadDockviewLayout).not.toHaveBeenCalled();
    expect(chunks.loadDataLoaderModule).not.toHaveBeenCalled();
    expect(chunks.loadWorkerManager).not.toHaveBeenCalled();
  });

  it('starts the layout and loader chunks and one prewarmed Parquet worker', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const { chunks, prewarmParquetWorker } = mockChunks();
    const { preloadLeRobotViewer } = await import('../src/react/preload');
    preloadLeRobotViewer();
    expect(chunks.loadDockviewLayout).toHaveBeenCalledTimes(1);
    expect(chunks.loadDataLoaderModule).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(prewarmParquetWorker).toHaveBeenCalledTimes(1));
  });

  it('never throws and leaves no unhandled rejection when a chunk fails', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    mockChunks({
      loadDockviewLayout: vi.fn(() => Promise.reject(new Error('chunk 404'))),
      loadDataLoaderModule: vi.fn(() => {
        throw new Error('synchronous failure');
      }),
      loadWorkerManager: vi.fn(() => Promise.reject(new Error('chunk 404'))),
    });
    const { preloadLeRobotViewer } = await import('../src/react/preload');
    expect(() => preloadLeRobotViewer()).not.toThrow();
    // A failure is reported when the viewer opens, not here.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
