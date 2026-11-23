import { expect } from 'vitest';

/**
 * Pause deterministically on `episode`. An episode opens paused, but a test
 * may have started playback: fixture episodes last 0.3 s and playback runs on
 * wall time, so sequential playback may already be on another episode (or, in
 * edit mode, hold at an episode end) by the time a slow, loaded test host
 * clicks. Pause with the play/pause button and make `episode` current while
 * paused.
 */
export async function pauseOnEpisode(host: HTMLElement, episode = 0): Promise<void> {
  const playPause = () => host.querySelector<HTMLButtonElement>('button[aria-label="Play/pause"]');
  const playing = () => playPause()?.querySelector('.lucide-pause') != null;
  const current = () =>
    host.querySelector(`[aria-label="Select Episode ${episode + 1}"][aria-current="true"]`);
  await expect.poll(() => playPause()?.disabled, { timeout: 10_000 }).toBe(false);
  for (let attempt = 0; attempt < 10; attempt++) {
    if (playing()) playPause()!.click();
    await expect.poll(playing, { timeout: 10_000 }).toBe(false);
    if (current()) {
      // Autoplay of a newly selected episode may still start; settle again.
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!playing() && current()) return;
      continue;
    }
    host.querySelector<HTMLButtonElement>(`[aria-label="Select Episode ${episode + 1}"]`)!.click();
    await expect.poll(current, { timeout: 10_000 }).not.toBeNull();
  }
  throw new Error(`Could not pause on episode ${episode}`);
}
