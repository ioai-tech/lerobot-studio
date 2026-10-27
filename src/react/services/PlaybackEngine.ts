import type { EpisodeMetadata, PlaybackMode, EpisodeTrimRange } from '@/core';

export type PlaybackEngineCallbacks = {
  getPreviewRange?: () => EpisodeTrimRange | undefined;
  getFrameIndex: () => number;
  setFrameIndexSilent: (index: number) => void;
  notifyFrame: (index: number) => void;
  getFrameCount: () => number;
  getFps: () => number;
  getPlaybackSpeed: () => number;
  getPlaybackMode: () => PlaybackMode;
  getEpisodes: () => EpisodeMetadata[];
  getSelectedEpisodeIndex: () => number | null;
  getDeletedEpisodes: () => Set<number>;
  onStop: () => void;
  /** When true, stay on this episode at the last frame instead of looping or advancing. */
  shouldHoldAtEpisodeEnd?: () => boolean;
  /** Fired after a hold-at-end stop, so the UI can open the last unlabeled subtask. */
  onNaturalEnd?: () => void;
  /** Resolves true only after the next episode is ready to play. */
  onAdvanceEpisode: (episodeIndex: number) => Promise<boolean>;
  onResumeAfterEpisode: () => void;
  /**
   * Native video clock (MediaSync): when it returns a value, the frame index follows the master
   * video instead of the timer, and playback holds while a video buffers.
   */
  getMediaClock?: () => { frameIndex: number; buffering: boolean } | null;
  onPlaybackStart?: (frameIndex: number, rate: number) => void;
  onPlaybackStop?: () => void;
  /**
   * Loop mode with the native clock: show the episode from frame 0 again (a prefetched standby when
   * there is one) and keep playing. Without it the videos are stopped and restarted.
   */
  onLoopRestart?: (rate: number) => void;
};

/**
 * Imperative playback loop (rAF + setTimeout) independent of React render.
 * Provider owns lifecycle; this class only schedules ticks and episode advances.
 */
export class PlaybackEngine {
  private animationFrameId: number | null = null;
  private timerId: number | null = null;
  private lastTickTime = 0;
  private running = false;
  /** The shuffle pick for the episode it was made from, so a prefetch and the advance agree. */
  private nextPick: { from: number | null; mode: PlaybackMode; next: number } | null = null;
  private readonly callbacks: PlaybackEngineCallbacks;

  constructor(callbacks: PlaybackEngineCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const range = this.callbacks.getPreviewRange?.();
    if (
      range &&
      (this.callbacks.getFrameIndex() < range.startFrame ||
        this.callbacks.getFrameIndex() >= range.endFrame)
    ) {
      this.callbacks.setFrameIndexSilent(range.startFrame);
      this.callbacks.notifyFrame(range.startFrame);
    }
    this.lastTickTime = 0;
    this.callbacks.onPlaybackStart?.(
      this.callbacks.getFrameIndex(),
      Math.max(0.1, this.callbacks.getPlaybackSpeed()),
    );
    this.animationFrameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    this.cancelScheduled();
    if (wasRunning) this.callbacks.onPlaybackStop?.();
  }

  dispose(): void {
    this.stop();
  }

  private cancelScheduled(): void {
    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.timerId != null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private scheduleNextTick = (timestamp: number, effectiveInterval: number): void => {
    const sinceLast = timestamp - this.lastTickTime;
    const delay = Math.max(0, effectiveInterval - sinceLast);
    if (delay <= 4) {
      this.animationFrameId = requestAnimationFrame(this.tick);
      return;
    }
    this.timerId = window.setTimeout(() => {
      this.timerId = null;
      this.animationFrameId = requestAnimationFrame(this.tick);
    }, delay);
  };

  /**
   * The episode playback advances to after the selected one (-1: none). Stable until the selection
   * or the mode changes, so the next episode can be prefetched.
   */
  peekNextEpisode(): number {
    const from = this.callbacks.getSelectedEpisodeIndex();
    const mode = this.callbacks.getPlaybackMode();
    if (this.nextPick && this.nextPick.from === from && this.nextPick.mode === mode) {
      return this.nextPick.next;
    }
    const next = this.resolveNextEpisode();
    this.nextPick = { from, mode, next };
    return next;
  }

  private resolveNextEpisode(): number {
    const { getPlaybackMode, getEpisodes, getSelectedEpisodeIndex, getDeletedEpisodes } =
      this.callbacks;
    const playbackMode = getPlaybackMode();
    const episodes = getEpisodes();
    const selectedEpisodeIndex = getSelectedEpisodeIndex();
    const deletedEpisodes = getDeletedEpisodes();

    let nextEpisodeIndex = -1;
    if (playbackMode === 'sequential') {
      const currentIndexInList = episodes.findIndex(
        (e) => e.episode_index === selectedEpisodeIndex,
      );
      if (currentIndexInList !== -1 && currentIndexInList < episodes.length - 1) {
        nextEpisodeIndex = episodes[currentIndexInList + 1].episode_index;
      } else if (currentIndexInList === episodes.length - 1) {
        nextEpisodeIndex = episodes[0].episode_index;
      }
    } else if (playbackMode === 'shuffle') {
      if (episodes.length > 1) {
        let randomIndex: number;
        do {
          randomIndex = Math.floor(Math.random() * episodes.length);
        } while (episodes[randomIndex].episode_index === selectedEpisodeIndex);
        nextEpisodeIndex = episodes[randomIndex].episode_index;
      } else if (episodes.length === 1) {
        nextEpisodeIndex = episodes[0].episode_index;
      }
    }

    let nextNonDeleted = nextEpisodeIndex;
    if (nextNonDeleted !== -1 && deletedEpisodes.has(nextNonDeleted)) {
      const nonDeletedList = episodes.filter((e) => !deletedEpisodes.has(e.episode_index));
      const idx = nonDeletedList.findIndex((e) => e.episode_index === selectedEpisodeIndex);
      nextNonDeleted =
        idx >= 0 && idx < nonDeletedList.length - 1
          ? nonDeletedList[idx + 1].episode_index
          : (nonDeletedList[0]?.episode_index ?? -1);
    }
    return nextNonDeleted;
  }

  private tick = (timestamp: number): void => {
    if (!this.running) return;
    if (!this.lastTickTime) {
      this.lastTickTime = timestamp;
    }

    const frameCount = this.callbacks.getFrameCount();
    if (frameCount <= 0) {
      this.stop();
      return;
    }

    const clock = this.callbacks.getMediaClock?.();
    if (clock) {
      const current = this.callbacks.getFrameIndex();
      if (!clock.buffering && clock.frameIndex !== current && this.advanceTo(clock.frameIndex)) {
        return;
      }
      this.lastTickTime = timestamp;
      this.animationFrameId = requestAnimationFrame(this.tick);
      return;
    }

    const fps = this.callbacks.getFps() || 30;
    const frameInterval = 1000 / fps;
    const effectiveInterval = frameInterval / Math.max(0.1, this.callbacks.getPlaybackSpeed());
    const elapsed = timestamp - this.lastTickTime;

    if (elapsed >= effectiveInterval) {
      if (this.advanceTo(this.callbacks.getFrameIndex() + 1)) return;
      this.lastTickTime = timestamp;
    }

    this.scheduleNextTick(timestamp, effectiveInterval);
  };

  /** Move to `target` (preview range, loop, hold or next episode at the end); true when playback stopped. */
  private advanceTo(target: number): boolean {
    const frameCount = this.callbacks.getFrameCount();
    let newIndex = target;

    const range = this.callbacks.getPreviewRange?.();
    if (range && newIndex > range.endFrame) {
      this.callbacks.onStop();
      this.stop();
      return true;
    }
    if (range && newIndex < range.startFrame) newIndex = range.startFrame;
    if (newIndex >= frameCount) {
      if (this.callbacks.shouldHoldAtEpisodeEnd?.()) {
        this.callbacks.onStop();
        this.callbacks.onNaturalEnd?.();
        this.stop();
        return true;
      }
      if (this.callbacks.getPlaybackMode() === 'loop') {
        newIndex = 0;
        this.callbacks.setFrameIndexSilent(newIndex);
        this.callbacks.notifyFrame(newIndex);
        if (this.callbacks.getMediaClock) {
          const rate = Math.max(0.1, this.callbacks.getPlaybackSpeed());
          if (this.callbacks.onLoopRestart) {
            this.callbacks.onLoopRestart(rate);
          } else {
            // restart the videos at the first frame
            this.callbacks.onPlaybackStop?.();
            this.callbacks.onPlaybackStart?.(newIndex, rate);
          }
        }
        return false;
      }
      this.callbacks.onStop();
      const next = this.peekNextEpisode();
      this.nextPick = null;
      if (next !== -1) {
        void this.callbacks.onAdvanceEpisode(next).then((loaded) => {
          if (loaded) this.callbacks.onResumeAfterEpisode();
        });
      }
      this.stop();
      return true;
    }
    this.callbacks.setFrameIndexSilent(newIndex);
    this.callbacks.notifyFrame(newIndex);
    return false;
  }
}
