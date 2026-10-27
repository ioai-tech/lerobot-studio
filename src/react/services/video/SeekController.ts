/**
 * Exact, coalescing seeks for one media element.
 *
 * - The latest target wins: a target set while a seek is in flight replaces the queued one, and is
 *   applied when the in-flight seek completes (`seeked`), so a fast scrub never piles up seeks and
 *   never drops its final position (the trailing edge).
 * - One seek in flight at a time; a target set before metadata is known is applied on
 *   `loadedmetadata` (a new `src` starts at 0).
 * - After `seeked` / `loadeddata` / `canplay` the element is checked against the target and the seek is
 *   re-applied when it is off by more than half a frame (a source swap or an external write moved it).
 * - `fast` uses `fastSeek()` where the browser has it (keyframe seeks while dragging); the exact
 *   seek on release replaces it.
 */

/** The part of HTMLMediaElement the controller drives (a plain object in tests). */
export interface SeekableMedia {
  currentTime: number;
  readonly readyState: number;
  readonly seeking: boolean;
  fastSeek?: (time: number) => void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;
/** Re-applications of one target before the controller gives up (a source that cannot reach it). */
const MAX_REAPPLY = 3;

/** Time of the centre of `frame` in a clip that starts at `start` (robust against float rounding). */
export function frameCentreTime(start: number, frame: number, fps: number): number {
  return start + (Math.max(0, frame) + 0.5) / fps;
}

/** The frame shown at `time` in a clip starting at `start`. */
export function frameAtTime(start: number, time: number, fps: number): number {
  return Math.max(0, Math.floor((time - start) * fps + 1e-3));
}

export class SeekController {
  private target: number | null = null;
  private fast = false;
  private force = false;
  private inFlight = false;
  private reapplied = 0;
  private disposed = false;
  private readonly settledListeners = new Set<() => void>();
  private readonly events = ['seeked', 'loadedmetadata', 'loadeddata', 'canplay'] as const;

  private readonly media: SeekableMedia;
  /** Seconds per frame; half of it is the tolerance. */
  private readonly frameDuration: () => number;

  constructor(media: SeekableMedia, frameDuration: () => number) {
    this.media = media;
    this.frameDuration = frameDuration;
    for (const type of this.events) media.addEventListener(type, this.onEvent);
    media.addEventListener('emptied', this.onEmptied);
  }

  /**
   * Seek to `time` (seconds). `fast`: a keyframe seek is good enough (scrubbing). `force`: seek even
   * when `currentTime` is already within half a frame — after a pause the picture can be a frame
   * ahead of `currentTime`, and only a seek puts that exact frame on screen.
   */
  seek(time: number, options: { fast?: boolean; force?: boolean } = {}): void {
    if (this.disposed || !Number.isFinite(time)) return;
    this.target = Math.max(0, time);
    this.fast = options.fast === true;
    this.force = options.force === true;
    this.reapplied = 0;
    this.pump();
  }

  /** Forget the pending target (playback took over). */
  cancel(): void {
    this.target = null;
  }

  /** The target still to reach, or null when settled. */
  get pendingTarget(): number | null {
    return this.target;
  }

  /** True when no target is pending and no seek is running. */
  isSettled(): boolean {
    return this.target === null && !this.inFlight && !this.media.seeking;
  }

  /** Resolves once the current target is reached and its frame is decoded (or immediately). */
  whenSettled(): Promise<void> {
    if (this.isSettled()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.settledListeners.delete(done);
        resolve();
      };
      this.settledListeners.add(done);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.target = null;
    for (const type of this.events) this.media.removeEventListener(type, this.onEvent);
    this.media.removeEventListener('emptied', this.onEmptied);
    this.flushSettled();
  }

  private tolerance(): number {
    return Math.max(0.001, this.frameDuration() / 2);
  }

  private pump(): void {
    const target = this.target;
    if (target === null || this.disposed) return;
    const media = this.media;
    if (media.readyState < HAVE_METADATA) return; // applied on loadedmetadata
    if (this.inFlight || media.seeking) return; // applied on seeked (latest target wins)

    const off = Math.abs(media.currentTime - target);
    if (off < this.tolerance() && !this.force) {
      if (media.readyState >= HAVE_CURRENT_DATA || this.fast) {
        this.target = null;
        this.flushSettled();
      }
      // else: the frame is not decoded yet; loadeddata / canplay re-check
      return;
    }
    if (this.reapplied >= MAX_REAPPLY) {
      // The element refuses this time (beyond its duration): accept where it is.
      this.target = null;
      this.flushSettled();
      return;
    }
    this.inFlight = true;
    this.force = false;
    if (this.fast && typeof media.fastSeek === 'function') {
      media.fastSeek(target);
    } else {
      media.currentTime = target;
    }
  }

  private readonly onEvent = (): void => {
    if (this.inFlight && !this.media.seeking) {
      this.inFlight = false;
      if (this.fast && this.target !== null) {
        // a keyframe seek lands near the target by design; the exact seek on release follows
        this.target = null;
        this.flushSettled();
        return;
      }
      if (
        this.target !== null &&
        Math.abs(this.media.currentTime - this.target) >= this.tolerance()
      ) {
        // the element moved elsewhere than asked (a source swap, the end of the media)
        this.reapplied += 1;
      }
    }
    this.pump();
  };

  private readonly onEmptied = (): void => {
    // A new source: the in-flight seek is gone; the target is applied on loadedmetadata.
    this.inFlight = false;
  };

  private flushSettled(): void {
    if (this.settledListeners.size === 0) return;
    for (const listener of [...this.settledListeners]) listener();
  }
}
