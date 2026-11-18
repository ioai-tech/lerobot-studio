import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// Committed, not generated: two cameras, 360 frames.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

/** Episode data arrives late, so its load is still in flight when the host swaps sources. */
class SlowData extends FetchDataSource {
  override async readBytes(path: string, onProgress?: Parameters<FetchDataSource['readBytes']>[1]) {
    if (path.startsWith('data/')) await new Promise((resolve) => setTimeout(resolve, 2500));
    return super.readBytes(path, onProgress);
  }
}

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
});

it('a source swap to the same episode drops the old source’s load, never fails the new one', async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
    original(...args);
  };
  try {
    await page.viewport(1280, 800);
    host = document.createElement('div');
    host.style.cssText = 'width:1280px;height:800px';
    document.body.append(host);
    root = createRoot(host);
    root.render(<LeRobotViewer dataSource={new SlowData(FRAME_CODED)} language="en" />);
    // The slow episode load has started.
    await expect
      .poll(
        () =>
          host!.querySelector('[role="slider"]') != null || host!.textContent!.includes('Loading'),
        { timeout: 30_000 },
      )
      .toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    // The host swaps to a fast source of the same dataset: episode 0 again.
    root.render(<LeRobotViewer dataSource={new FetchDataSource(FRAME_CODED)} language="en" />);
    await expect.poll(() => host!.querySelectorAll('video').length, { timeout: 30_000 }).toBe(2);
    // Past the old source's late data.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    expect(errors.filter((error) => error.includes('Failed to load episode data'))).toEqual([]);
    expect(host.textContent).not.toContain('released');
    expect(
      host
        .querySelector('[role="slider"][aria-label="Playback progress"]')
        ?.getAttribute('aria-valuemax'),
    ).toBe('359');
  } finally {
    console.error = original;
  }
});
