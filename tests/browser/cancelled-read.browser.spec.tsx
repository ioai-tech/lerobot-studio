import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeRobotDataLoader } from '@/platform';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FeatureSubscriptionBatcher } from '../../src/react/contexts/useFeatureSubscriptions';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FIXTURE = '/tests/fixtures/datasets/lerobotv3';
const DATA = 'data/chunk-000/file-000.parquet';

/**
 * Reads the fixture; once `hold()` is called, the next episode data read waits
 * until `release()` (a slow link), or fails with `fail()` (a lost connection).
 */
class HeldDataSource extends FetchDataSource {
  private holding = false;
  private waiting: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  dataReads = 0;
  constructor() {
    super(FIXTURE);
  }
  hold() {
    this.holding = true;
  }
  release() {
    this.holding = false;
    this.waiting.splice(0).forEach(({ resolve }) => resolve());
  }
  fail(error: Error) {
    this.holding = false;
    this.waiting.splice(0).forEach(({ reject }) => reject(error));
  }
  get held() {
    return this.waiting.length;
  }
  override async readBytes(path: string) {
    if (path === DATA) {
      this.dataReads += 1;
      if (this.holding) {
        await new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
      }
    }
    return super.readBytes(path);
  }
}

/** A batcher reading `features` of episode 0 from `loader`, as the provider's is. */
function batcherFor(
  loader: LeRobotDataLoader,
  info: Awaited<ReturnType<typeof loader.initialize>>,
) {
  const onError = vi.fn();
  const onFeatureData = vi.fn();
  const batcher = new FeatureSubscriptionBatcher({
    getSnapshot: () => ({ episodeIndex: 0, loader, info, chartData: {}, featureData: {} }),
    onFeatureData,
    onError,
    // Flushed by the test.
    schedule: () => 1,
    cancel: () => undefined,
  });
  return { batcher, onError, onFeatureData };
}

describe('a read cancelled by the viewer going away is quiet; a failed read is not (walk m-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a read in flight when its loader is disposed rejects as cancelled (AbortError), not "Proxy has been released"', async () => {
    const source = new HeldDataSource();
    const loader = new LeRobotDataLoader(source);
    await loader.initialize();
    source.hold();
    const read = loader.loadFeatureData(0, ['observation.state']);
    read.catch(() => undefined);
    await expect.poll(() => source.held).toBe(1);
    await loader.dispose();
    source.release();
    const error = await read.then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.name).toBe('AbortError');
    expect(error?.message).not.toContain('Proxy has been released');
  });

  it('the batcher says nothing about a read its viewer cancelled by unmounting', async () => {
    const source = new HeldDataSource();
    const loader = new LeRobotDataLoader(source);
    const info = await loader.initialize();
    const { batcher, onError, onFeatureData } = batcherFor(loader, info);
    await batcher.subscribe('observation.state');
    source.hold();
    const flushed = batcher.flush();
    await expect.poll(() => source.held).toBe(1);
    // Unmount: the provider disposes its loader (the worker goes) while the read waits.
    await loader.dispose();
    source.release();
    await flushed;
    expect(onError).not.toHaveBeenCalled();
    expect(onFeatureData).not.toHaveBeenCalled();
  });

  it('a read that fails while the viewer is shown is still reported', async () => {
    const source = new HeldDataSource();
    const loader = new LeRobotDataLoader(source);
    const info = await loader.initialize();
    const { batcher, onError } = batcherFor(loader, info);
    await batcher.subscribe('observation.state');
    source.hold();
    const flushed = batcher.flush();
    await expect.poll(() => source.held).toBe(1);
    source.fail(new TypeError('Failed to fetch'));
    await flushed;
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toContain('Failed to load batched feature data');
    expect((onError.mock.calls[0]![1] as Error).message).toBe('Failed to fetch');
    await loader.dispose();
  });

  it('unmounting the viewer while its episode reads logs no error', async () => {
    const errors: string[] = [];
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '));
      original(...args);
    });
    const source = new HeldDataSource();
    source.hold();
    const host = document.createElement('div');
    host.style.cssText = 'width:1024px;height:768px';
    document.body.append(host);
    const root = createRoot(host);
    root.render(<LeRobotViewer dataSource={source} language="en" />);
    await expect.poll(() => source.held, { timeout: 60_000 }).toBeGreaterThan(0);
    // The host shows something else (Data -> Raw): the viewer unmounts mid-read.
    root.unmount();
    host.remove();
    source.release();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(errors).toEqual([]);
  });
});
