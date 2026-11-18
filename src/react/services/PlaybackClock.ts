/**
 * The single time owner of playback.
 *
 * Time is seconds from the start of the selected episode. While playing it
 * advances with wall time × rate, and it **holds** while any participant (a
 * camera that is buffering) has a hold registered, so a stalled camera stops
 * the clock instead of drifting behind it. Cameras play natively and follow
 * the clock; charts and the frame index are derived from it.
 */
export type PlaybackClockListener = () => void;

export class PlaybackClock {
  private baseTime = 0;
  private baseWall = 0;
  private playing = false;
  private rate = 1;
  private seekSerial = 0;
  private readonly holds = new Set<string>();
  private readonly listeners = new Set<PlaybackClockListener>();
  private readonly wallNow: () => number;

  constructor(wallNow: () => number = () => performance.now()) {
    this.wallNow = wallNow;
  }

  /** True while play was requested (even if a hold pauses time). */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** True while time actually advances: playing and nobody holds the clock. */
  get isRunning(): boolean {
    return this.playing && this.holds.size === 0;
  }

  /** Playback rate (1 = real time). */
  get playbackRate(): number {
    return this.rate;
  }

  /** Increments on every explicit seek; followers hard-seek when it changes. */
  get seekVersion(): number {
    return this.seekSerial;
  }

  /** Ids currently holding the clock (for diagnostics). */
  get holders(): string[] {
    return [...this.holds];
  }

  /** Current time in seconds. */
  now(): number {
    return this.timeAt(this.wallNow());
  }

  /** Clock time at a wall-clock timestamp (same domain as `performance.now()`). */
  timeAt(wall: number): number {
    if (!this.isRunning) return this.baseTime;
    return this.baseTime + (Math.max(0, wall - this.baseWall) / 1000) * this.rate;
  }

  play(): void {
    if (this.playing) return;
    this.rebase();
    this.playing = true;
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.rebase();
    this.playing = false;
    this.emit();
  }

  /** Jump to `time` seconds. Followers re-align immediately. */
  seek(time: number): void {
    this.baseTime = Math.max(0, time);
    this.baseWall = this.wallNow();
    this.seekSerial += 1;
    this.emit();
  }

  setRate(rate: number): void {
    const next = Number.isFinite(rate) && rate > 0 ? rate : 1;
    if (next === this.rate) return;
    this.rebase();
    this.rate = next;
    this.emit();
  }

  /** Stop time until `release(id)`; idempotent per id. */
  hold(id: string): void {
    if (this.holds.has(id)) return;
    this.rebase();
    this.holds.add(id);
    this.emit();
  }

  release(id: string): void {
    if (!this.holds.has(id)) return;
    this.rebase();
    this.holds.delete(id);
    this.emit();
  }

  subscribe(listener: PlaybackClockListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private rebase(): void {
    const wall = this.wallNow();
    this.baseTime = this.timeAt(wall);
    this.baseWall = wall;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Playback clock listener failed', error);
      }
    }
  }
}

/** Frame shown at clock time `time` (frame k covers [k/fps, (k+1)/fps)). */
export function frameAtTime(time: number, fps: number): number {
  return Math.max(0, Math.floor(time * fps + 1e-6));
}

/** Clock time at the start of frame `frame`. */
export function timeOfFrame(frame: number, fps: number): number {
  return frame / fps;
}
