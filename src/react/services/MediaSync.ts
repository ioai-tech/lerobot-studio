/**
 * Native, synchronised video playback.
 *
 * While playing, every registered video runs `play()` and the first one with metadata is the master:
 * its `currentTime` is the playback clock (the engine reads the frame index from it). Followers are
 * pulled to the master by nudging `playbackRate`, and seek only when they are far off. When any video
 * runs short of data, all pause until every one can play again, so cameras and charts never drift
 * apart and the timeline never runs ahead of the pixels.
 *
 * Paused, scrubbing and frame stepping keep the per-frame seek in VideoPanel.
 */

/** The part of HTMLVideoElement the controller drives (a plain object in tests). */
export interface SyncedVideo {
  currentTime: number;
  playbackRate: number;
  readonly readyState: number;
  readonly ended: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SyncedMedia {
  video: SyncedVideo;
  /** Start of the selected episode in this file, in seconds; null while the episode is not set. */
  getStart: () => number | null;
}

export interface MediaClock {
  /** Frame index of the master video; `Infinity` once the master video ended. */
  frameIndex: number;
  /** True while playback waits for a video to buffer. */
  buffering: boolean;
}

const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;
/** Followers further than this from the master seek instead of catching up. */
const HARD_SYNC_SECONDS = 0.5;
/** Followers within this many frames run at the master rate. */
const SOFT_SYNC_FRAMES = 1.5;
const RATE_NUDGE = 0.05;

export class MediaSync {
  private readonly media = new Map<string, SyncedMedia>();
  private readonly bufferingListeners = new Set<(buffering: boolean) => void>();
  private playing = false;
  private held = false;
  private rate = 1;
  private fps = 30;

  register(id: string, media: SyncedMedia): () => void {
    this.media.set(id, media);
    if (this.playing && !this.held) {
      const master = this.master();
      if (master && master !== media) this.align(media, master, true);
      this.play(media);
    }
    return () => {
      if (this.media.get(id) === media) this.media.delete(id);
    };
  }

  setFps(fps: number | null | undefined): void {
    this.fps = fps && fps > 0 ? fps : 30;
  }

  /** True while videos drive the clock; VideoPanel then leaves frame-by-frame seeking alone. */
  isActive(): boolean {
    return this.playing && this.master() !== null;
  }

  isBuffering(): boolean {
    return this.held;
  }

  onBufferingChange(listener: (buffering: boolean) => void): () => void {
    this.bufferingListeners.add(listener);
    return () => this.bufferingListeners.delete(listener);
  }

  /** Begin native playback at `frameIndex` (the engine's current frame). */
  start(frameIndex: number, rate: number): void {
    this.playing = true;
    this.rate = rate > 0 ? rate : 1;
    this.held = false;
    for (const media of this.ready()) {
      const start = media.getStart() ?? 0;
      const target = start + frameIndex / this.fps;
      if (Math.abs(media.video.currentTime - target) > 1 / this.fps) {
        media.video.currentTime = target;
      }
      media.video.playbackRate = this.rate;
      this.play(media);
    }
  }

  /** Change the playback rate of running videos (speed control). */
  setRate(rate: number): void {
    this.rate = rate > 0 ? rate : 1;
    if (!this.playing) return;
    for (const media of this.media.values()) media.video.playbackRate = this.rate;
  }

  stop(): void {
    const wasHeld = this.held;
    this.playing = false;
    this.held = false;
    for (const media of this.media.values()) {
      media.video.pause();
      media.video.playbackRate = this.rate;
    }
    if (wasHeld) this.emit(false);
  }

  /** The master's frame and the buffering state; null when no video can drive the clock. */
  tick(): MediaClock | null {
    if (!this.playing) return null;
    const master = this.master();
    if (!master) return null;

    const starving = this.ready().some(
      (media) => !media.video.ended && media.video.readyState < HAVE_FUTURE_DATA,
    );
    if (starving && !this.held) {
      this.held = true;
      for (const media of this.media.values()) media.video.pause();
      this.emit(true);
    } else if (!starving && this.held) {
      this.held = false;
      for (const media of this.ready()) {
        if (media !== master) this.align(media, master, true);
        this.play(media);
      }
      this.emit(false);
    } else if (!this.held) {
      for (const media of this.ready()) {
        if (media !== master) this.align(media, master, false);
      }
    }

    if (master.video.ended) return { frameIndex: Number.POSITIVE_INFINITY, buffering: false };
    const start = master.getStart() ?? 0;
    const frameIndex = Math.max(0, Math.round((master.video.currentTime - start) * this.fps));
    return { frameIndex, buffering: this.held };
  }

  private ready(): SyncedMedia[] {
    return [...this.media.values()].filter(
      (media) => media.getStart() !== null && media.video.readyState >= HAVE_METADATA,
    );
  }

  private master(): SyncedMedia | null {
    return this.ready()[0] ?? null;
  }

  private align(media: SyncedMedia, master: SyncedMedia, hard: boolean): void {
    const offset = master.video.currentTime - (master.getStart() ?? 0);
    const target = (media.getStart() ?? 0) + offset;
    const drift = media.video.currentTime - target;
    if (Math.abs(drift) > HARD_SYNC_SECONDS || (hard && Math.abs(drift) > 1 / this.fps)) {
      media.video.currentTime = target;
      media.video.playbackRate = this.rate;
    } else if (Math.abs(drift) > SOFT_SYNC_FRAMES / this.fps) {
      media.video.playbackRate = this.rate * (drift > 0 ? 1 - RATE_NUDGE : 1 + RATE_NUDGE);
    } else {
      media.video.playbackRate = this.rate;
    }
  }

  private play(media: SyncedMedia): void {
    try {
      const pending = media.video.play();
      if (pending && typeof pending.catch === 'function') {
        pending.catch(() => {
          // A rejected play() (source swapped, element detached) shows up as buffering on the next tick.
        });
      }
    } catch {
      // same as above
    }
  }

  private emit(buffering: boolean): void {
    this.bufferingListeners.forEach((listener) => listener(buffering));
  }
}
