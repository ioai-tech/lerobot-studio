import type { EpisodeMetadata, PlaybackMode, EpisodeTrimRange } from '@/core';
import { frameAtTime, PlaybackClock, timeOfFrame } from './PlaybackClock';

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
};

/**
 * Imperative playback loop independent of React render. The frame index is
 * derived from the shared `PlaybackClock` on every animation frame (never
 * incremented per tick), so presented time follows wall time exactly and a
 * buffering camera that holds the clock holds the frame index too. The
 * provider owns lifecycle; this class only maps clock time to frames and
 * handles the episode end.
 */
export class PlaybackEngine {
  private animationFrameId: number | null = null;
  private running = false;
  private readonly callbacks: PlaybackEngineCallbacks;
  readonly clock: PlaybackClock;

  constructor(callbacks: PlaybackEngineCallbacks, clock: PlaybackClock = new PlaybackClock()) {
    this.callbacks = callbacks;
    this.clock = clock;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const fps = this.fps();
    const range = this.callbacks.getPreviewRange?.();
    let frame = this.callbacks.getFrameIndex();
    if (range && (frame < range.startFrame || frame >= range.endFrame)) {
      frame = range.startFrame;
      this.callbacks.setFrameIndexSilent(frame);
      this.callbacks.notifyFrame(frame);
    }
    if (frameAtTime(this.clock.now(), fps) !== frame) {
      this.clock.seek(timeOfFrame(frame, fps));
    }
    this.clock.setRate(this.speed());
    this.clock.play();
    this.animationFrameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.clock.pause();
    this.cancelScheduled();
  }

  dispose(): void {
    this.stop();
  }

  private fps(): number {
    return this.callbacks.getFps() || 30;
  }

  private speed(): number {
    return Math.max(0.1, this.callbacks.getPlaybackSpeed());
  }

  private cancelScheduled(): void {
    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /** Park the clock and the frame index on `frame` (used at range and episode ends). */
  private settleAt(frame: number): void {
    this.clock.pause();
    this.clock.seek(timeOfFrame(frame, this.fps()));
    if (this.callbacks.getFrameIndex() !== frame) {
      this.callbacks.setFrameIndexSilent(frame);
      this.callbacks.notifyFrame(frame);
    }
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

  private tick = (): void => {
    this.animationFrameId = null;
    if (!this.running) return;

    const frameCount = this.callbacks.getFrameCount();
    if (frameCount <= 0) {
      this.callbacks.onStop();
      this.stop();
      return;
    }

    this.clock.setRate(this.speed());
    const fps = this.fps();
    let frame = frameAtTime(this.clock.now(), fps);

    const range = this.callbacks.getPreviewRange?.();
    if (range && frame > range.endFrame) {
      this.settleAt(range.endFrame);
      this.callbacks.onStop();
      this.stop();
      return;
    }
    if (range && frame < range.startFrame) {
      frame = range.startFrame;
      this.clock.seek(timeOfFrame(frame, fps));
    }

    if (frame >= frameCount) {
      if (this.callbacks.shouldHoldAtEpisodeEnd?.()) {
        this.settleAt(frameCount - 1);
        this.callbacks.onStop();
        this.callbacks.onNaturalEnd?.();
        this.stop();
        return;
      }
      if (this.callbacks.getPlaybackMode() === 'loop') {
        frame = 0;
        this.clock.seek(0);
      } else {
        this.settleAt(frameCount - 1);
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
    }

    if (frame !== this.callbacks.getFrameIndex()) {
      this.callbacks.setFrameIndexSilent(frame);
      this.callbacks.notifyFrame(frame);
    }
    this.animationFrameId = requestAnimationFrame(this.tick);
  };
}
