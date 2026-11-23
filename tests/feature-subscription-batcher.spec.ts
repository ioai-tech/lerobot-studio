import { describe, expect, it, vi } from 'vitest';
import type { LeRobotInfo } from '../src/core';
import type { LeRobotDataLoader, NumericalColumnMap } from '../src/platform';
import { FeatureSubscriptionBatcher } from '../src/react/contexts/useFeatureSubscriptions';

const info = {
  features: {
    scalar: { dtype: 'float32', shape: [1], names: null },
    vector: { dtype: 'float32', shape: [2], names: null },
    image: { dtype: 'image', shape: [1], names: null },
  },
} as unknown as LeRobotInfo;

describe('FeatureSubscriptionBatcher', () => {
  it('coalesces subscriptions and reuses eager numerical columns', async () => {
    let scheduled: (() => void) | undefined;
    const loadFeatureData = vi.fn(async () => ({ vector: [[3, 4]] }));
    const onFeatureData = vi.fn();
    const chartData: NumericalColumnMap = {
      scalar: { values: new Float64Array([1, 2]), rows: 2, width: 1 },
    };
    const batcher = new FeatureSubscriptionBatcher({
      getSnapshot: () => ({
        episodeIndex: 7,
        loader: { loadFeatureData } as unknown as LeRobotDataLoader,
        info,
        chartData,
        featureData: {},
      }),
      onFeatureData,
      schedule: (callback) => {
        scheduled = callback;
        return 1;
      },
    });

    await batcher.subscribe('scalar');
    await batcher.subscribe('vector');
    await batcher.subscribe('vector');
    scheduled?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(loadFeatureData).toHaveBeenCalledOnce();
    expect(loadFeatureData).toHaveBeenCalledWith(7, ['vector']);
    expect(onFeatureData).toHaveBeenCalledWith({ scalar: [1, 2] });
    expect(onFeatureData).toHaveBeenCalledWith({ vector: [[3, 4]] });
  });

  it('leaves features to the episode load while its chart columns are still read', async () => {
    let scheduled: (() => void) | undefined;
    const loadFeatureData = vi.fn(async () => ({ vector: [[3, 4]] }));
    const onFeatureData = vi.fn();
    const batcher = new FeatureSubscriptionBatcher({
      getSnapshot: () => ({
        episodeIndex: 7,
        loader: { loadFeatureData } as unknown as LeRobotDataLoader,
        info,
        chartData: {},
        chartColumnsPending: true,
        featureData: {},
      }),
      onFeatureData,
      schedule: (callback) => {
        scheduled = callback;
        return 1;
      },
    });

    await batcher.subscribe('vector');
    scheduled?.();
    await Promise.resolve();
    // No read competing with the charts; the episode load reads subscribed features after them.
    expect(loadFeatureData).not.toHaveBeenCalled();
    expect(batcher.getSubscribedFeatureNames(info)).toEqual(['vector']);
  });

  it('does not schedule media features and filters inactive subscriptions', async () => {
    const schedule = vi.fn(() => 1);
    const cancel = vi.fn();
    const batcher = new FeatureSubscriptionBatcher({
      getSnapshot: () => ({
        episodeIndex: 0,
        loader: {} as LeRobotDataLoader,
        info,
        chartData: {},
        featureData: {},
      }),
      onFeatureData: vi.fn(),
      schedule,
      cancel,
    });

    await batcher.subscribe('image');
    await batcher.subscribe('scalar');
    batcher.unsubscribe('scalar');

    expect(schedule).toHaveBeenCalledOnce();
    expect(batcher.getSubscribedFeatureNames(info)).toEqual([]);
    batcher.dispose();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it('cancels queued work and ignores stale in-flight results on cleanup', async () => {
    let resolveLoad!: (data: Record<string, unknown[]>) => void;
    const loadFeatureData = vi.fn(
      () => new Promise<Record<string, unknown[]>>((resolve) => (resolveLoad = resolve)),
    );
    const cancel = vi.fn();
    const onFeatureData = vi.fn();
    const batcher = new FeatureSubscriptionBatcher({
      getSnapshot: () => ({
        episodeIndex: 1,
        loader: { loadFeatureData } as unknown as LeRobotDataLoader,
        info,
        chartData: {},
        featureData: {},
      }),
      onFeatureData,
      schedule: () => 11,
      cancel,
    });

    await batcher.subscribe('scalar');
    const flushing = batcher.flush();
    batcher.dispose();
    resolveLoad({ scalar: [9] });
    await flushing;

    expect(cancel).not.toHaveBeenCalled();
    expect(onFeatureData).not.toHaveBeenCalled();
  });

  it('does not report a read cancelled because its viewer went away (AbortError)', async () => {
    let scheduled: (() => void) | undefined;
    const onError = vi.fn();
    const cancelled = new DOMException('The Parquet worker was released', 'AbortError');
    const batcher = new FeatureSubscriptionBatcher({
      getSnapshot: () => ({
        episodeIndex: 7,
        loader: { loadFeatureData: vi.fn(async () => Promise.reject(cancelled)) } as never,
        info,
        chartData: {},
        featureData: {},
      }),
      onFeatureData: vi.fn(),
      onError,
      schedule: (callback) => {
        scheduled = callback;
        return 1;
      },
    });
    await batcher.subscribe('vector');
    scheduled?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not report a read that failed after it was superseded (unmount or another episode)', async () => {
    let fail: (error: Error) => void = () => undefined;
    const onError = vi.fn();
    const batcher = new FeatureSubscriptionBatcher({
      getSnapshot: () => ({
        episodeIndex: 7,
        loader: {
          loadFeatureData: vi.fn(
            () =>
              new Promise((_, reject) => {
                fail = reject;
              }),
          ),
        } as never,
        info,
        chartData: {},
        featureData: {},
      }),
      onFeatureData: vi.fn(),
      onError,
      schedule: () => 1,
      cancel: () => undefined,
    });
    await batcher.subscribe('vector');
    const flushed = batcher.flush();
    batcher.dispose();
    fail(new Error('Failed to fetch'));
    await flushed;
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a read that failed while it was still wanted', async () => {
    const onError = vi.fn();
    const failure = new TypeError('Failed to fetch');
    const batcher = new FeatureSubscriptionBatcher({
      getSnapshot: () => ({
        episodeIndex: 7,
        loader: { loadFeatureData: vi.fn(async () => Promise.reject(failure)) } as never,
        info,
        chartData: {},
        featureData: {},
      }),
      onFeatureData: vi.fn(),
      onError,
      schedule: () => 1,
      cancel: () => undefined,
    });
    await batcher.subscribe('vector');
    await batcher.flush();
    expect(onError).toHaveBeenCalledWith(
      'Failed to load batched feature data for episode 7',
      failure,
    );
  });
});
