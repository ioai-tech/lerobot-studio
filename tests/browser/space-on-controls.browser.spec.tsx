import React from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const isPlaying = (button: HTMLElement) => Boolean(button.querySelector('.lucide-pause'));

it('Space activates a focused button once and toggles playback only when no control has focus', async () => {
  await page.viewport(1280, 900);
  const host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(
      <LeRobotViewer
        dataSource={new FetchDataSource('/tests/fixtures/datasets/lerobotv3')}
        language="en"
        showSidebar
        showPlaybackBar
      />,
    );
    const playButton = () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]')!;
    const nextButton = () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Next frame"]')!;
    await expect.poll(() => playButton()?.disabled, { timeout: 60_000 }).toBe(false);
    await expect.poll(() => nextButton()?.disabled, { timeout: 60_000 }).toBe(false);

    // Loop the (three-frame) episode so playback cannot end on its own mid-test,
    // and make sure it is paused.
    const modeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle playback mode"]',
    )!;
    modeButton.click(); // sequential -> shuffle
    await expect.poll(() => modeButton.querySelector('.lucide-shuffle')).not.toBeNull();
    modeButton.click(); // shuffle -> loop
    await expect
      .poll(() => modeButton.querySelector('[class*="repeat-1"], [class*="repeat1"]'))
      .not.toBeNull();
    if (isPlaying(playButton())) playButton().click();
    await expect.poll(() => isPlaying(playButton())).toBe(false);
    playButton().blur();

    // A focused "Next frame" button: Space clicks it exactly once and never toggles playback.
    let nextClicks = 0;
    nextButton().addEventListener('click', () => nextClicks++);
    nextButton().focus();
    await userEvent.keyboard(' ');
    await expect.poll(() => nextClicks).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(nextClicks).toBe(1);
    expect(isPlaying(playButton())).toBe(false);

    // A focused Play/pause button: one press is one toggle, not a shortcut plus a click.
    let playClicks = 0;
    playButton().addEventListener('click', () => playClicks++);
    playButton().focus();
    await userEvent.keyboard(' ');
    await expect.poll(() => isPlaying(playButton())).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(playClicks).toBe(1);
    expect(isPlaying(playButton())).toBe(true);
    await userEvent.keyboard(' ');
    await expect.poll(() => isPlaying(playButton())).toBe(false);
    expect(playClicks).toBe(2);

    // Nothing focused: Space is the play/pause shortcut.
    playButton().blur();
    await userEvent.keyboard(' ');
    await expect.poll(() => isPlaying(playButton())).toBe(true);
    expect(playClicks).toBe(2);
    await userEvent.keyboard(' ');
    await expect.poll(() => isPlaying(playButton())).toBe(false);
  } finally {
    root.unmount();
    host.remove();
  }
});
