import { frameAtTime, type PlaybackClock } from './PlaybackClock';

/** Drift beyond this (seconds) is corrected with one seek instead of a rate trim. */
export const HARD_SEEK_DRIFT_S = 0.5;
/** While held, a camera further than this many frames from the clock seeks to it. */
export const HELD_SEEK_FRAMES = 2;
/** A paused camera this close (in frames) to its target is already there. */
const SAME_POSITION_FRAMES = 0.1;
/** Rate trim per second of smoothed drift (0.033 s ahead → 6.6 % slower until aligned). */
const RATE_GAIN = 1;
const MAX_RATE_TRIM = 0.1;
/** Start trimming beyond this many frames of smoothed drift; stop below the second. */
const TRIM_START_FRAMES = 1.5;
const TRIM_STOP_FRAMES = 0.5;
/** Drift smoothing (exponential moving average weight of the newest frame). */
const DRIFT_SMOOTHING = 0.1;
/** Minimum time between playbackRate changes. */
const MIN_RATE_CHANGE_INTERVAL_MS = 250;
const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;

export interface CameraFollowerOptions {
  /** Unique id used for clock holds. */
  id: string;
  fps: () => number;
  /** Media time range of the selected episode in this camera's file, or null when not ready. */
  range: () => { start: number; end: number } | null;
}

type VideoFrameMetadataLike = { mediaTime: number; expectedDisplayTime: number };
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadataLike) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Makes one `<video>` follow the shared playback clock.
 *
 * - Playing: the element plays natively at the clock rate; each presented
 *   frame (`requestVideoFrameCallback`) measures drift against the clock and
 *   trims `playbackRate` slightly; drift above 0.5 s or a clock seek causes one
 *   seek. Buffering (`waiting`, or a seek in progress) holds the clock so the
 *   other cameras and the charts wait instead of running ahead.
 * - Paused: the element is paused on the centre of the clock's frame; seeks
 *   are coalesced (one in flight, the latest target wins), so scrubbing never
 *   queues a seek storm.
 */
export class CameraFollower {
  private readonly video: VideoWithFrameCallback;
  private readonly clock: PlaybackClock;
  private readonly options: CameraFollowerOptions;
  private readonly cleanups: Array<() => void> = [];
  private seeking = false;
  private seekPending = false;
  private held = false;
  private failed = false;
  private seenSeekVersion = -1;
  private frameCallback: number | null = null;
  private disposed = false;
  private smoothedDrift: number | null = null;
  private trimming = false;
  private lastRateChange = 0;
  /** Last paused seek target; never re-sought without a new clock seek (no loops). */
  private lastPausedTarget: number | null = null;

  constructor(video: HTMLVideoElement, clock: PlaybackClock, options: CameraFollowerOptions) {
    this.video = video as VideoWithFrameCallback;
    this.clock = clock;
    this.options = options;
    this.cleanups.push(clock.subscribe(() => this.sync()));
    const on = (type: string, handler: () => void) => {
      video.addEventListener(type, handler);
      this.cleanups.push(() => video.removeEventListener(type, handler));
    };
    on('loadedmetadata', () => {
      this.failed = false;
      this.seenSeekVersion = -1;
      this.sync();
    });
    on('waiting', () => this.holdIfPlaying());
    on('seeked', () => this.onSeeked());
    on('canplay', () => this.releaseIfReady());
    on('canplaythrough', () => this.releaseIfReady());
    on('playing', () => this.releaseIfReady());
    on('error', () => {
      this.failed = true;
      this.seeking = false;
      this.release();
    });
    on('emptied', () => {
      this.seeking = false;
      this.seekPending = false;
    });
    this.watchFrames();
  }

  /** Re-evaluate position and play state (episode, range or source changes). */
  sync(): void {
    if (this.disposed || this.failed) return;
    const video = this.video;
    const range = this.options.range();
    if (!range || video.readyState < HAVE_METADATA) {
      if (!this.clock.isPlaying) this.release();
      return;
    }
    const fps = this.options.fps() || 30;
    const seekRequested = this.clock.seekVersion !== this.seenSeekVersion;
    this.seenSeekVersion = this.clock.seekVersion;

    if (!this.clock.isPlaying) {
      this.release();
      if (!video.paused) video.pause();
      // Compare with the clamped target, not the frame: a video shorter than
      // the data can never present the last data frames, and chasing them
      // would seek forever.
      const target = this.frameCentre(frameAtTime(this.clock.now(), fps), range, fps);
      if (seekRequested || Math.abs(video.currentTime - target) > SAME_POSITION_FRAMES / fps) {
        if (!seekRequested && this.lastPausedTarget === target) return;
        this.lastPausedTarget = target;
        this.seekTo(target);
      }
      return;
    }

    this.lastPausedTarget = null;
    const target = this.clampTime(range.start + this.clock.now(), range, fps);
    if (seekRequested || Math.abs(video.currentTime - target) > HARD_SEEK_DRIFT_S) {
      this.seekTo(target);
    }
    if (this.seeking) {
      this.holdIfPlaying();
      return;
    }
    if (video.readyState < HAVE_FUTURE_DATA) this.holdIfPlaying();
    if (this.clock.isRunning) {
      if (Math.abs(video.playbackRate - this.clock.playbackRate) > MAX_RATE_TRIM) {
        video.playbackRate = this.clock.playbackRate;
      }
      if (video.paused) void video.play().catch(() => undefined);
    } else {
      // Held (another camera buffers): pause. A camera more than a couple of
      // frames from the clock's time seeks to it so cameras resume together;
      // smaller offsets are left to the rate trim, because a seek per hold
      // makes a slow decoder buffer again and holds every camera once more.
      if (!video.paused) video.pause();
      const heldAt = this.clampTime(range.start + this.clock.now(), range, fps);
      if (Math.abs(video.currentTime - heldAt) > HELD_SEEK_FRAMES / fps) this.seekTo(heldAt);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.release();
    if (this.frameCallback != null) this.video.cancelVideoFrameCallback?.(this.frameCallback);
    this.frameCallback = null;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  private frameCentre(frame: number, range: { start: number; end: number }, fps: number): number {
    return this.clampTime(range.start + (frame + 0.5) / fps, range, fps);
  }

  private clampTime(time: number, range: { start: number; end: number }, fps: number): number {
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
    const end = Math.min(range.end > range.start ? range.end : duration, duration);
    return Math.max(range.start, Math.min(time, end - 0.25 / fps));
  }

  private seekTo(time: number): void {
    if (this.seeking) {
      this.seekPending = true;
      return;
    }
    this.seeking = true;
    this.holdIfPlaying();
    this.video.currentTime = time;
  }

  private onSeeked(): void {
    this.seeking = false;
    if (this.seekPending) {
      this.seekPending = false;
      // Recompute from the clock: the latest target wins.
      this.seenSeekVersion = -1;
    }
    this.sync();
    this.releaseIfReady();
  }

  private holdIfPlaying(): void {
    if (this.disposed || this.failed || !this.clock.isPlaying || this.held) return;
    this.held = true;
    this.clock.hold(this.options.id);
  }

  private releaseIfReady(): void {
    if (this.seeking || this.video.readyState < HAVE_FUTURE_DATA) return;
    const wasHeld = this.held;
    this.release();
    if (wasHeld) this.sync();
  }

  private release(): void {
    if (!this.held) return;
    this.held = false;
    this.clock.release(this.options.id);
  }

  private watchFrames(): void {
    const video = this.video;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    const onFrame = (_now: number, metadata: VideoFrameMetadataLike) => {
      if (this.disposed) return;
      this.frameCallback = video.requestVideoFrameCallback!(onFrame);
      this.trimRate(metadata);
    };
    this.frameCallback = video.requestVideoFrameCallback(onFrame);
  }

  /** Keep a playing camera within a frame of the clock by trimming its rate. */
  private trimRate(metadata: VideoFrameMetadataLike): void {
    const video = this.video;
    if (!this.clock.isRunning || video.paused || this.seeking) {
      this.smoothedDrift = null;
      return;
    }
    const range = this.options.range();
    if (!range) return;
    const fps = this.options.fps() || 30;
    const clockTime = this.clock.timeAt(metadata.expectedDisplayTime);
    const drift = metadata.mediaTime - range.start + 0.5 / fps - clockTime;
    if (Math.abs(drift) > HARD_SEEK_DRIFT_S) {
      this.smoothedDrift = null;
      this.seekTo(this.clampTime(range.start + this.clock.now(), range, fps));
      return;
    }
    this.smoothedDrift =
      this.smoothedDrift == null
        ? drift
        : this.smoothedDrift + DRIFT_SMOOTHING * (drift - this.smoothedDrift);
    const driftFrames = Math.abs(this.smoothedDrift) * fps;
    if (!this.trimming && driftFrames > TRIM_START_FRAMES) this.trimming = true;
    else if (this.trimming && driftFrames < TRIM_STOP_FRAMES) this.trimming = false;
    const trim = this.trimming
      ? Math.max(-MAX_RATE_TRIM, Math.min(MAX_RATE_TRIM, -this.smoothedDrift * RATE_GAIN))
      : 0;
    const rate = this.clock.playbackRate * (1 + trim);
    const now = metadata.expectedDisplayTime;
    if (
      Math.abs(video.playbackRate - rate) > 0.005 &&
      (trim === 0 || now - this.lastRateChange >= MIN_RATE_CHANGE_INTERVAL_MS)
    ) {
      video.playbackRate = rate;
      this.lastRateChange = now;
    }
  }
}
