import type { EpisodeMetadata, PlaybackMode } from '@/core';

export type PlaybackEngineCallbacks = {
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
  private readonly callbacks: PlaybackEngineCallbacks;

  constructor(callbacks: PlaybackEngineCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = 0;
    this.animationFrameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.cancelScheduled();
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

    const fps = this.callbacks.getFps() || 30;
    const frameInterval = 1000 / fps;
    const effectiveInterval = frameInterval / Math.max(0.1, this.callbacks.getPlaybackSpeed());
    const elapsed = timestamp - this.lastTickTime;

    if (elapsed >= effectiveInterval) {
      let newIndex = this.callbacks.getFrameIndex() + 1;

      if (newIndex >= frameCount) {
        if (this.callbacks.shouldHoldAtEpisodeEnd?.()) {
          this.callbacks.onStop();
          this.callbacks.onNaturalEnd?.();
          this.stop();
          return;
        }
        if (this.callbacks.getPlaybackMode() === 'loop') {
          newIndex = 0;
          this.callbacks.setFrameIndexSilent(newIndex);
          this.callbacks.notifyFrame(newIndex);
        } else {
          this.callbacks.onStop();
          const next = this.resolveNextEpisode();
          if (next !== -1) {
            void this.callbacks.onAdvanceEpisode(next).then((loaded) => {
              if (loaded) this.callbacks.onResumeAfterEpisode();
            });
          }
          this.stop();
          return;
        }
      } else {
        this.callbacks.setFrameIndexSilent(newIndex);
        this.callbacks.notifyFrame(newIndex);
      }

      this.lastTickTime = timestamp;
    }

    this.scheduleNextTick(timestamp, effectiveInterval);
  };
}
