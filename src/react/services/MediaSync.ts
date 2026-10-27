/**
 * Native, synchronised video playback.
 *
 * While playing, every registered video runs `play()` and the first one with metadata is the master:
 * its `currentTime` is the playback clock (the engine reads the frame index from it). Followers are
 * pulled to the master by nudging `playbackRate`, and seek only when they are far off. When any video
 * runs short of data, all pause until every one can play again, so cameras and charts never drift
 * apart and the timeline never runs ahead of the pixels.
 *
 * The master stops on the last frame of the episode (`getEnd`), before the next episode of a shared
 * file can show. A camera can swap its element (a preview / original switch, a renewed URL) without
 * leaving the group: `refresh(id)` hands the play state over to the new element.
 *
 * Paused, scrubbing and frame stepping are seeked by the video stage.
 */

import { frameAtTime, frameCentreTime } from './video/SeekController';

/** The part of HTMLVideoElement the controller drives (a plain object in tests). */
export interface SyncedVideo {
  currentTime: number;
  playbackRate: number;
  readonly readyState: number;
  readonly ended: boolean;
  readonly paused?: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SyncedMedia {
  /** The element on screen; may change between calls (the camera swapped sources). */
  readonly video: SyncedVideo;
  /** Start of the selected episode in this file, in seconds; null while the episode is not set. */
  getStart: () => number | null;
  /** End (`to_timestamp`) of the selected episode in this file, in seconds, when known. */
  getEnd?: () => number | null;
  /**
   * Exact seek (coalescing); defaults to writing `currentTime`. `once`: a correction of a playing
   * element, not re-checked where it landed (it plays on).
   */
  seek?: (time: number, options?: { once?: boolean }) => void;
  /**
   * The camera is switching to another episode and shows no picture of the selected one yet: it
   * does not play, and the clock holds until it can (the timeline never runs ahead of a camera).
   */
  isPending?: () => boolean;
}

export interface MediaClock {
  /** Frame index of the master video; `Infinity` once the master reached the episode end. */
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
/** The clock ticks per animation frame; stop this far (scaled by rate) before the next frame. */
const TICK_LOOKAHEAD_SECONDS = 0.025;

export class MediaSync {
  private readonly media = new Map<string, SyncedMedia>();
  private readonly bufferingListeners = new Set<(buffering: boolean, switching: boolean) => void>();
  private playing = false;
  private held = false;
  private atEnd = false;
  private rate = 1;
  private fps = 30;

  register(id: string, media: SyncedMedia): () => void {
    this.media.set(id, media);
    if (this.playing && !this.held && !this.atEnd && !isPending(media)) {
      const master = this.master();
      if (master && master !== media) this.align(media, master, true);
      media.video.playbackRate = this.rate;
      this.play(media);
    }
    return () => {
      if (this.media.get(id) === media) {
        this.media.delete(id);
        media.video.pause();
      }
    };
  }

  /**
   * The camera `id` now shows another element (`media.video` changed): give it the play state.
   * The previous element is paused by its owner.
   */
  refresh(id: string): void {
    const media = this.media.get(id);
    if (!media) return;
    media.video.playbackRate = this.rate;
    if (!this.playing || this.held || this.atEnd || isPending(media)) {
      media.video.pause();
      return;
    }
    const master = this.master();
    if (master && master !== media) this.align(media, master, false);
    this.play(media);
  }

  setFps(fps: number | null | undefined): void {
    this.fps = fps && fps > 0 ? fps : 30;
  }

  /** True while videos drive the clock; frame-by-frame seeking is then left to `seekFrame`. */
  isActive(): boolean {
    return this.playing && this.master() !== null;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  isBuffering(): boolean {
    return this.held;
  }

  /** `switching`: the hold waits for a camera switching episodes, not for the link. */
  onBufferingChange(listener: (buffering: boolean, switching: boolean) => void): () => void {
    this.bufferingListeners.add(listener);
    return () => this.bufferingListeners.delete(listener);
  }

  /** Begin native playback at `frameIndex` (the engine's current frame). */
  start(frameIndex: number, rate: number): void {
    this.playing = true;
    this.atEnd = false;
    this.rate = rate > 0 ? rate : 1;
    this.held = false;
    // a camera still switching to this episode: everyone waits for it (on the frame to start from)
    const wait = this.pending();
    for (const media of this.ready()) {
      const start = media.getStart() ?? 0;
      const time = media.video.currentTime;
      // seek unless the element already shows that frame (a time before the episode shows none)
      const shown = time < start - 1e-6 ? -1 : frameAtTime(start, time, this.fps);
      if (shown !== frameIndex) this.seekMedia(media, frameCentreTime(start, frameIndex, this.fps));
      media.video.playbackRate = this.rate;
      if (!wait) this.play(media);
    }
    if (wait) this.hold();
  }

  /**
   * Jump every camera to `frameIndex` while playing (timeline click, arrow-key step): the master
   * and the followers move together and the clock continues from there.
   */
  seekFrame(frameIndex: number): void {
    this.atEnd = false;
    for (const media of this.ready()) {
      const start = media.getStart() ?? 0;
      this.seekMedia(media, frameCentreTime(start, frameIndex, this.fps));
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
    this.atEnd = false;
    for (const media of this.media.values()) {
      media.video.pause();
      media.video.playbackRate = this.rate;
    }
    if (wasHeld) this.emit(false);
  }

  /**
   * The master's frame and the buffering state; null when no video takes part (the engine's timer
   * runs the clock). Cameras that take part but cannot drive it yet (loading, switching episodes)
   * hold the clock instead: it never runs without a picture.
   */
  tick(): MediaClock | null {
    if (!this.playing) return null;
    const master = this.master();
    if (!master) {
      if (this.media.size === 0) return null;
      this.hold();
      return { frameIndex: Number.NaN, buffering: true };
    }
    if (this.atEnd) return { frameIndex: Number.POSITIVE_INFINITY, buffering: false };

    if (this.reachedEnd(master)) {
      this.clampAtEnd(master);
      return { frameIndex: Number.POSITIVE_INFINITY, buffering: false };
    }

    const starving =
      this.pending() ||
      this.ready().some((media) => !media.video.ended && media.video.readyState < HAVE_FUTURE_DATA);
    if (starving && !this.held) {
      this.hold();
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

    const start = master.getStart() ?? 0;
    return {
      frameIndex: frameAtTime(start, master.video.currentTime, this.fps),
      buffering: this.held,
    };
  }

  private reachedEnd(master: SyncedMedia): boolean {
    if (master.video.ended) return true;
    const end = master.getEnd?.();
    if (end === null || end === undefined || !Number.isFinite(end)) return false;
    // The last frame starts one frame before `end`; stop before the next frame (the next episode
    // of a shared file) can be presented.
    const lastFrameStart = end - 1 / this.fps;
    return master.video.currentTime >= lastFrameStart - TICK_LOOKAHEAD_SECONDS * this.rate;
  }

  /** Pause every camera on the centre of its episode's last frame. */
  private clampAtEnd(master: SyncedMedia): void {
    this.atEnd = true;
    const masterStart = master.getStart() ?? 0;
    const masterEnd = master.getEnd?.();
    const lastFrame =
      masterEnd !== null && masterEnd !== undefined && Number.isFinite(masterEnd)
        ? Math.max(0, Math.round((masterEnd - masterStart) * this.fps) - 1)
        : frameAtTime(masterStart, master.video.currentTime, this.fps);
    for (const media of this.ready()) {
      media.video.pause();
      if (media.video.ended) continue;
      const start = media.getStart() ?? 0;
      const target = frameCentreTime(start, lastFrame, this.fps);
      if (Math.abs(media.video.currentTime - target) > 0.5 / this.fps)
        this.seekMedia(media, target);
    }
    if (this.held) {
      this.held = false;
      this.emit(false);
    }
  }

  /** Cameras that show the selected episode and can play (not switching to it). */
  private ready(): SyncedMedia[] {
    return [...this.media.values()].filter(
      (media) =>
        !isPending(media) && media.getStart() !== null && media.video.readyState >= HAVE_METADATA,
    );
  }

  private pending(): boolean {
    for (const media of this.media.values()) if (isPending(media)) return true;
    return false;
  }

  private hold(): void {
    if (this.held) return;
    this.held = true;
    for (const media of this.media.values()) media.video.pause();
    this.emit(true, this.pending() || this.master() === null);
  }

  private master(): SyncedMedia | null {
    return this.ready()[0] ?? null;
  }

  private seekMedia(media: SyncedMedia, time: number, options?: { once?: boolean }): void {
    if (media.seek) media.seek(time, options);
    else media.video.currentTime = time;
  }

  private align(media: SyncedMedia, master: SyncedMedia, hard: boolean): void {
    const offset = master.video.currentTime - (master.getStart() ?? 0);
    const target = (media.getStart() ?? 0) + offset;
    const drift = media.video.currentTime - target;
    if (Math.abs(drift) > HARD_SYNC_SECONDS || (hard && Math.abs(drift) > 1 / this.fps)) {
      // through the camera's seek controller: a direct write would race a seek it has in flight
      this.seekMedia(media, target, { once: true });
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

  private emit(buffering: boolean, switching = false): void {
    this.bufferingListeners.forEach((listener) => listener(buffering, switching));
  }
}

function isPending(media: SyncedMedia): boolean {
  return media.isPending?.() ?? false;
}
