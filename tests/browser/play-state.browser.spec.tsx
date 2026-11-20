import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

/** Two episodes of three frames. */
const FIXTURE = '/tests/fixtures/datasets/lerobotv3';

/**
 * s10 F-14: nothing starts on its own. An episode opens paused on its first
 * frame (a review tool keeps the item still), and selecting another episode
 * keeps the play state: paused stays paused, playing keeps playing.
 */
describe('play state on open and on select (s10 F-14)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1280, 800);
    host = document.createElement('div');
    host.style.cssText = 'width:1280px;height:800px';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
  });

  const playPause = () => host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]');
  const playing = () => playPause()?.querySelector('.lucide-pause') != null;
  const current = (episode: number) =>
    host.querySelector(`[aria-label="Select Episode ${episode}"][aria-current="true"]`) != null;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
  const ready = async () => {
    await expect.poll(() => playPause()?.disabled, { timeout: 60_000 }).toBe(false);
  };

  it('opens paused on the first frame, and a selection made while paused stays paused', async () => {
    root.render(<LeRobotViewer dataSource={new FetchDataSource(FIXTURE)} language="en" />);
    await ready();
    await settle();
    expect(playing()).toBe(false);
    expect(current(0)).toBe(true);

    host.querySelector<HTMLButtonElement>('[aria-label="Select Episode 1"]')!.click();
    await expect.poll(() => current(1), { timeout: 20_000 }).toBe(true);
    await ready();
    await settle();
    expect(playing()).toBe(false);
  });

  it('a selection made while playing keeps playing', async () => {
    root.render(<LeRobotViewer dataSource={new FetchDataSource(FIXTURE)} language="en" />);
    await ready();
    // Loop the episode, so three frames keep playing until the next selection.
    const mode = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle playback mode"]',
    )!;
    mode.click();
    mode.click();
    if (!playing()) playPause()!.click();
    await expect.poll(playing).toBe(true);

    host.querySelector<HTMLButtonElement>('[aria-label="Select Episode 1"]')!.click();
    await expect.poll(() => current(1), { timeout: 20_000 }).toBe(true);
    await expect.poll(playing, { timeout: 20_000 }).toBe(true);
  });
});
