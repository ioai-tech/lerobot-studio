import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { SelectionBridge, type SelectionCarry } from '@/components/Host/SelectionBridge';
import {
  LeRobotDataContext,
  LeRobotPlaybackContext,
  LeRobotSegmentContext,
  LeRobotSelectionContext,
  type LeRobotDataContextType,
  type LeRobotPlaybackContextType,
  type LeRobotSegmentContextType,
  type LeRobotSelectionContextType,
} from '@/contexts/LeRobotContext';
import type { LeRobotSelection } from '@/contexts/hostTypes';
import { useLeRobotData } from '@/contexts/LeRobotContext';
import { LeRobotStudioProvider } from '@/public-api';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FPS = 30;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The provider side the bridge listens to, driven by the test. */
function fakeProvider() {
  let frame = 0;
  let pending = false;
  const frameSubscribers = new Set<(frame: number) => void>();
  const settledListeners = new Set<() => void>();
  const data = {
    info: { fps: FPS },
    episodes: [{ episode_index: 0, length: 300 }],
    getFrameIndex: () => frame,
    subscribeFrameIndex: (callback: (frame: number) => void) => {
      frameSubscribers.add(callback);
      return () => frameSubscribers.delete(callback);
    },
    hasPendingSelection: () => pending,
    subscribeSelectionSettled: (listener: () => void) => {
      settledListeners.add(listener);
      return () => settledListeners.delete(listener);
    },
  } as unknown as LeRobotDataContextType;
  return {
    data,
    setFrame(next: number) {
      frame = next;
      frameSubscribers.forEach((callback) => callback(next));
    },
    setPending(next: boolean) {
      pending = next;
    },
    settle() {
      pending = false;
      settledListeners.forEach((listener) => listener());
    },
  };
}

it('reports the time held back during a pending selection once it settles, without a new frame', async () => {
  const provider = fakeProvider();
  const reports: LeRobotSelection[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const captureRef = { current: () => null as SelectionCarry | null };
  try {
    root.render(
      <LeRobotDataContext.Provider value={provider.data}>
        <LeRobotSelectionContext.Provider
          value={{ selectedEpisodeIndex: 0 } as unknown as LeRobotSelectionContextType}
        >
          <LeRobotPlaybackContext.Provider
            value={{ isPlaying: false } as unknown as LeRobotPlaybackContextType}
          >
            <LeRobotSegmentContext.Provider
              value={{ selectedSegmentId: 'c' } as unknown as LeRobotSegmentContextType}
            >
              <SelectionBridge
                captureRef={captureRef}
                onSelectionChange={(selection) => reports.push(selection)}
              />
            </LeRobotSegmentContext.Provider>
          </LeRobotPlaybackContext.Provider>
        </LeRobotSelectionContext.Provider>
      </LeRobotDataContext.Provider>,
    );
    await expect
      .poll(() => reports.at(-1))
      .toEqual({
        episodeIndex: 0,
        segmentId: 'c',
        timeS: 0,
      });

    // A step inside the 250 ms window: its report waits for the trailing timer.
    provider.setFrame(277);
    // A swap starts before that timer fires; the selection is pending when it does.
    provider.setPending(true);
    await sleep(400);
    expect(reports.at(-1)?.timeS).toBe(0);

    // The swap lands where it was: no frame change, only the settle.
    provider.settle();
    await expect
      .poll(() => reports.at(-1))
      .toEqual({
        episodeIndex: 0,
        segmentId: 'c',
        timeS: 277 / FPS,
      });
  } finally {
    root.unmount();
    host.remove();
  }
});

it('the provider announces a pending selection that is dropped, and only then', async () => {
  let data: LeRobotDataContextType | null = null;
  function Probe() {
    data = useLeRobotData();
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(
      <LeRobotStudioProvider>
        <Probe />
      </LeRobotStudioProvider>,
    );
    await expect.poll(() => data).not.toBeNull();
    const provider = data!;
    let settled = 0;
    const stop = provider.subscribeSelectionSettled(() => {
      settled += 1;
    });
    provider.setPendingSelection(null); // nothing was pending
    expect(settled).toBe(0);
    provider.setPendingSelection({ episodeIndex: 0, frame: 3 });
    expect(provider.hasPendingSelection()).toBe(true);
    provider.setPendingSelection(null);
    expect(provider.hasPendingSelection()).toBe(false);
    expect(settled).toBe(1);
    stop();
    provider.setPendingSelection({ episodeIndex: 0, frame: 3 });
    provider.setPendingSelection(null);
    expect(settled).toBe(1);
  } finally {
    root.unmount();
    host.remove();
  }
});
