/**
 * One camera: two stacked <video> elements (on screen + standby) that outlive panels and layouts.
 *
 * - Source swaps (another file, the preview / original switch, a renewed URL, a prefetched next
 *   episode) load into the standby element, seek it to the target frame before any data of the
 *   start is fetched, and promote it once its frame is decoded and presented. The element on
 *   screen keeps its picture until then: no black frame, no frame of another episode.
 * - Episodes in the same file seek the element on screen (exact, coalescing seeks).
 * - The elements live in the panel that shows the camera; when a layout rebuilds its panels they
 *   park off-screen in the document (still loaded, still playing) and move into the new panel.
 * - URLs that expire are renewed before they do; failing sources retry with backoff and stop with a
 *   named error.
 */

import type { MediaSync, SyncedMedia, SyncedVideo } from '../MediaSync';
import { SeekController, frameCentreTime } from './SeekController';
import { DEFAULT_RETRY_POLICY, RetryBudget, isSignatureRefused, type RetryPolicy } from './retry';
import { bufferedAhead, type Rendition } from './quality';

/** One camera's view of an episode: the file and the episode's time range in it. */
export interface CameraSource {
  path: string;
  /** `from_timestamp` of the episode in this file (s). */
  start: number;
  /** `to_timestamp` (s), or null when unknown (the file's duration is used). */
  end: number | null;
  /** The preview copy or the original video (default: original). */
  rendition?: Rendition;
}

export type CameraErrorCode = 'VIDEO_UNAVAILABLE' | 'VIDEO_URL_REFUSED';

export interface CameraSnapshot {
  /** No source yet / first source loading / showing a frame / gave up. */
  status: 'empty' | 'loading' | 'ready' | 'error';
  /** Waiting for data on the element on screen (playback or a seek). */
  buffering: boolean;
  /** Another episode or file is loading in the standby element. */
  switching: boolean;
  /** Rendition on screen (null: nothing yet). */
  rendition: Rendition | null;
  /** While playing: the other rendition of the same episode loads behind the picture. */
  pendingRendition: Rendition | null;
  errorCode: CameraErrorCode | null;
  path: string | null;
  width: number;
  height: number;
  start: number | null;
  end: number | null;
}

/** What a player needs from the stage. */
export interface PlayerEnvironment {
  readonly mediaSync: MediaSync;
  fps(): number;
  /** The playhead (frame of the selected episode). */
  frameIndex(): number;
  getUrl(path: string): Promise<string>;
  /** A URL valid for the next minutes (asks the source to re-sign when it expires soon). */
  refreshUrl(path: string): Promise<string>;
  /** The source refused the URL: the next `getUrl` re-signs. */
  invalidateUrl(path: string): Promise<void>;
  getUrlExpiry(path: string): number | null;
  /** Off-screen container in the document that keeps elements alive between panels. */
  parking(): HTMLElement;
  retryPolicy: RetryPolicy;
  /** HTTP status of `url` (Range 0-0), to tell an expired signature from a server failure. */
  probe(url: string): Promise<number | null>;
  /** The camera was shown or hidden. */
  onVisibilityChange?(player: CameraPlayer): void;
  /** A swap finished: the camera shows its new source. */
  onPromoted?(player: CameraPlayer): void;
  /**
   * Playing, a switch to another rendition gave up: the clock kept overtaking what the standby
   * could buffer (the link does not carry the file). The camera keeps what it shows.
   */
  onSwitchStarved?(player: CameraPlayer): void;
}

type JobPurpose = 'show' | 'prefetch' | 'renew' | 'recover';

interface Job {
  id: number;
  purpose: JobPurpose;
  source: CameraSource;
  frame: number;
  url: string | null;
  element: HTMLVideoElement;
  ready: boolean;
  failed: boolean;
  /** A readiness check loop is running. */
  watching: boolean;
  /** Resolves when the job is ready (true) or failed / superseded (false). */
  settled: Promise<boolean>;
  resolve: (ok: boolean) => void;
  /** While playing: promote when the clock reaches this time of the old element. */
  rendezvous: number | null;
  /** When the standby was last aimed at its target (ms), to learn how long it takes to get ready. */
  aimedAt: number;
  /** How long the last aim took to get ready (ms). */
  readyLatency: number | null;
  /** Times the playing clock overtook what the standby had buffered. */
  overtaken: number;
  /** The standby plays hidden ahead of the clock to fill its buffer. */
  prerolling: boolean;
  /** When it first started to (ms): a buffer that does not grow in `PREROLL_MAX_MS` gives up. */
  prerollSince: number | null;
  group: TransitionGroup | null;
  startedAt: number;
}

/** Cameras that switch together (paused): all promote in the same frame. */
export class TransitionGroup {
  private readonly pending = new Set<CameraPlayer>();
  private readonly ready = new Set<CameraPlayer>();
  private sealed = false;
  private closed = false;

  add(player: CameraPlayer): void {
    if (this.closed) return;
    this.pending.add(player);
  }

  /** Every member joined: promote as soon as all are ready (now, when they already are). */
  seal(): void {
    this.sealed = true;
    this.maybeFlush();
  }

  /** A member is ready (or failed: it keeps its current picture). */
  settle(player: CameraPlayer, ok: boolean): void {
    if (this.closed || !this.pending.delete(player)) return;
    if (ok) this.ready.add(player);
    this.maybeFlush();
  }

  /** A member left the transition (superseded). */
  drop(player: CameraPlayer): void {
    if (this.closed) return;
    this.pending.delete(player);
    this.ready.delete(player);
    this.maybeFlush();
  }

  private maybeFlush(): void {
    if (!this.sealed || this.closed || this.pending.size > 0) return;
    this.closed = true;
    for (const player of this.ready) player.promoteGroupJob(this);
  }
}

const HAVE_CURRENT_DATA = 2;
const HAVE_FUTURE_DATA = 3;
/**
 * While playing, a camera switches to another rendition only when the standby has this much media
 * buffered past the switch (s, scaled by the rate; less near the end of the episode): a switch never
 * trades a playing picture for a stall.
 */
export const SUSTAIN_AHEAD_SECONDS = 3;
/** URL renewal; `renewLeadMs` before the expiry the URL is re-signed and swapped in (tests shorten it). */
export const VIDEO_URL_POLICY = { renewLeadMs: 90_000 };
/** Elements without a panel for this long release their source. */
const PARK_RELEASE_MS = 3_000;
/** A camera hidden this long lets go of its element (ms). */
const HIBERNATE_MS = 1_500;
/** While playing, a swap is prepared this far ahead of the clock and promoted when it gets there. */
const RENDEZVOUS_LEAD_SECONDS = 0.6;
/** A playing switch gives up after the clock overtook the standby's buffer this many times. */
const MAX_OVERTAKEN = 4;
/** Head start of a standby that plays ahead to fill its buffer after the clock caught it (s). */
const PREROLL_LEAD_SECONDS = 2;
const PREROLL_MAX_MS = 12_000;

type VideoFrameCallback = (now: number, metadata: { mediaTime: number }) => void;
type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

let nextJobId = 1;

function createVideoElement(): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'metadata';
  video.disablePictureInPicture = true;
  video.setAttribute('disableRemotePlayback', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.dataset.lerobotVideo = 'true';
  Object.assign(video.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    backgroundColor: 'transparent',
    transform: 'translateZ(0)',
  });
  return video;
}

/** Stop a media element's network and decoder work. */
export function releaseMediaElement(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // ignore
  }
  if (video.hasAttribute('src') || video.currentSrc) {
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // ignore
    }
  }
}

export class CameraPlayer {
  readonly key: string;
  private readonly env: PlayerEnvironment;
  private readonly elements: [HTMLVideoElement, HTMLVideoElement];
  private readonly seekers: [SeekController, SeekController];
  private readonly presented = new WeakMap<HTMLVideoElement, number>();
  private activeIndex = 0;
  private activeUrl: string | null = null;
  private source: CameraSource | null = null;
  private job: Job | null = null;
  private snapshot: CameraSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly retry: RetryBudget;
  private retryTimer: number | null = null;
  private renewTimer: number | null = null;
  private releaseTimer: number | null = null;
  private hosts: HTMLElement[] = [];
  private readonly visibleHosts = new Set<HTMLElement>();
  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Hosts in the viewport, and hosts with an area: visible = both. */
  private readonly intersecting = new Set<HTMLElement>();
  private readonly sized = new Set<HTMLElement>();
  private unregisterSync: (() => void) | null = null;
  private readonly syncedMedia: SyncedMedia;
  private disposed = false;
  private readonly frameCallbacks = new WeakMap<HTMLVideoElement, number>();
  private readonly mirrors = new Map<HTMLElement, HTMLCanvasElement>();
  private mirrorHandle: number | null = null;
  private hibernateTimer: number | null = null;
  /** Paused swap: the old picture painted on a canvas while its element let go of its connection. */
  private cover: HTMLCanvasElement | null = null;
  private frozenFrame: number | null = null;

  constructor(key: string, env: PlayerEnvironment) {
    this.key = key;
    this.env = env;
    this.retry = new RetryBudget(() => env.retryPolicy ?? DEFAULT_RETRY_POLICY);
    this.elements = [createVideoElement(), createVideoElement()];
    this.elements.forEach((element) => (element.dataset.lerobotCamera = key));
    this.seekers = [
      new SeekController(this.elements[0], () => 1 / this.env.fps()),
      new SeekController(this.elements[1], () => 1 / this.env.fps()),
    ];
    this.snapshot = {
      status: 'empty',
      buffering: false,
      switching: false,
      rendition: null,
      pendingRendition: null,
      errorCode: null,
      path: null,
      width: 0,
      height: 0,
      start: null,
      end: null,
    };
    const active = (): SyncedVideo => this.active;
    this.syncedMedia = {
      get video(): SyncedVideo {
        return active();
      },
      getStart: () => (this.activeUrl ? (this.source?.start ?? null) : null),
      getEnd: () => this.sourceEnd(),
      seek: (time) => this.activeSeeker.seek(time),
    };
    for (const element of this.elements) this.listen(element);
    this.applyRoles();
    this.env.parking().append(...this.elements);
  }

  // ---------------------------------------------------------------- state

  /** The element on screen. */
  get active(): HTMLVideoElement {
    return this.elements[this.activeIndex];
  }

  /** The element that loads swaps. */
  get standby(): HTMLVideoElement {
    return this.elements[1 - this.activeIndex];
  }

  private get activeSeeker(): SeekController {
    return this.seekers[this.activeIndex];
  }

  private seekerOf(element: HTMLVideoElement): SeekController {
    return this.seekers[this.elements.indexOf(element)];
  }

  getSnapshot = (): CameraSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<CameraSnapshot>): void {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (this.snapshot[key as keyof CameraSnapshot] !== value) changed = true;
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  /** Both elements (tests and diagnostics). */
  getElements(): readonly HTMLVideoElement[] {
    return this.elements;
  }

  /** The episode currently on screen. */
  getSource(): CameraSource | null {
    return this.source;
  }

  isVisible(): boolean {
    return this.visibleHosts.size > 0;
  }

  /** Panels showing this camera. */
  hostCount(): number {
    return this.hosts.length;
  }

  private sourceEnd(): number | null {
    if (!this.source || !this.activeUrl) return null;
    if (this.source.end !== null && this.source.end > this.source.start) return this.source.end;
    const duration = this.active.duration;
    return Number.isFinite(duration) ? duration : null;
  }

  /** Time of `frame` in `source`, clamped inside the episode and the file. */
  private frameTime(source: CameraSource, frame: number, element?: HTMLVideoElement): number {
    const fps = this.env.fps();
    let time = frameCentreTime(source.start, frame, fps);
    const end = source.end !== null && source.end > source.start ? source.end : null;
    if (end !== null) time = Math.min(time, end - 0.5 / fps);
    const duration = element?.duration;
    if (duration && Number.isFinite(duration)) time = Math.min(time, duration - 0.25 / fps);
    return Math.max(source.start, time);
  }

  // ---------------------------------------------------------------- showing sources

  /**
   * Show `source` at `frame`. Same file: an exact seek of the element on screen. Another file (or a
   * prefetched one): through the standby element. `group` makes several cameras promote together.
   */
  show(source: CameraSource, frame: number, group: TransitionGroup | null): void {
    if (this.disposed) return;
    this.clearRetry();
    if (this.snapshot.status === 'error') this.update({ status: 'loading', errorCode: null });

    // A prefetched (or in-flight) standby already loads this file: take it over.
    const job = this.job;
    if (job && !job.failed && job.source.path === source.path) {
      job.source = source;
      job.purpose = 'show';
      this.retarget(job, frame);
      if (group) this.joinGroup(job, group);
      else this.finishWhenReady(job);
      this.update({ switching: Boolean(this.activeUrl) });
      return;
    }

    if (this.activeUrl && this.source?.path === source.path && this.frozenFrame === null) {
      const sameEpisode = Math.abs(this.source.start - source.start) < 1e-6;
      this.cancelJob();
      this.source = source;
      this.update({ start: source.start, end: source.end, switching: false });
      // the rendition on screen again while playing (a pending switch was called off): no seek
      if (!(sameEpisode && this.env.mediaSync.isPlaying())) this.seekActive(frame, false);
      this.refreshSyncRegistration();
      return;
    }

    this.startJob('show', source, frame, group);
  }

  /** Load `source` at `frame` in the standby element ahead of time (next episode, loop start). */
  prefetch(source: CameraSource, frame: number): void {
    if (this.disposed || !this.activeUrl || !this.source) return;
    if (this.job && this.job.purpose !== 'prefetch') return; // a real swap is running
    if (this.job && this.job.source.path === source.path && this.job.frame === frame) return;
    if (source.path === this.source.path && this.isBuffered(this.frameTime(source, frame))) return;
    this.startJob('prefetch', source, frame, null);
  }

  cancelPrefetch(): void {
    if (this.job?.purpose === 'prefetch') this.cancelJob();
  }

  /**
   * Paused seek / scrub to `frame` of the episode being shown (or being switched to). `exact`
   * re-seeks even when the element reports that time already (after playback stopped).
   */
  seekFrame(frame: number, fast: boolean, exact = false): void {
    if (this.disposed) return;
    const job = this.job;
    if (job && job.purpose !== 'prefetch' && job.purpose !== 'renew') {
      this.retarget(job, frame);
      return;
    }
    if (!this.activeUrl || !this.source) return;
    this.activeSeeker.seek(this.frameTime(this.source, frame, this.active), {
      fast,
      force: exact,
    });
  }

  /** Swap in the same file under a fresh URL (a renewed presigned URL); keeps time and play state. */
  private swapUrl(purpose: 'renew' | 'recover'): void {
    if (!this.source) return;
    const frame = this.currentFrame();
    this.startJob(purpose, this.source, frame, null);
  }

  /** Frame shown by the element on screen. */
  currentFrame(): number {
    if (this.frozenFrame !== null) return this.frozenFrame;
    if (!this.source) return 0;
    const fps = this.env.fps();
    return Math.max(0, Math.floor((this.active.currentTime - this.source.start) * fps + 1e-3));
  }

  private seekActive(frame: number, fast: boolean): void {
    if (!this.source) return;
    this.activeSeeker.seek(this.frameTime(this.source, frame, this.active), { fast });
  }

  private retarget(job: Job, frame: number): void {
    job.frame = frame;
    job.ready = false;
    job.aimedAt = performance.now();
    const time = this.frameTime(job.source, frame, job.element);
    this.seekerOf(job.element).seek(time);
    if (job.purpose !== 'prefetch') job.element.preload = 'auto';
    // a job that was ready (a prefetch taken over) checks its readiness again
    if (job.url && !job.watching) this.waitReady(job);
  }

  private isBuffered(time: number): boolean {
    const ranges = this.active.buffered;
    for (let index = 0; index < ranges.length; index++) {
      if (ranges.start(index) <= time && time <= ranges.end(index) - 0.1) return true;
    }
    return false;
  }

  private startJob(
    purpose: JobPurpose,
    source: CameraSource,
    frame: number,
    group: TransitionGroup | null,
  ): void {
    this.cancelJob();
    const element = this.standby;
    let resolve: (ok: boolean) => void = () => undefined;
    const settled = new Promise<boolean>((done) => (resolve = done));
    const job: Job = {
      id: nextJobId++,
      purpose,
      source,
      frame,
      url: null,
      element,
      ready: false,
      failed: false,
      watching: false,
      settled,
      resolve,
      rendezvous: null,
      aimedAt: performance.now(),
      readyLatency: null,
      overtaken: 0,
      prerolling: false,
      prerollSince: null,
      group: null,
      startedAt: performance.now(),
    };
    this.job = job;
    if (group) this.joinGroup(job, group);
    if (purpose === 'show' && this.activeUrl && !this.env.mediaSync.isPlaying()) this.freeze();
    if (!this.activeUrl) this.update({ status: 'loading', path: source.path });
    else if (purpose === 'show') {
      const sameEpisode = this.source !== null && Math.abs(this.source.start - source.start) < 1e-6;
      const rendition = source.rendition ?? 'original';
      if (sameEpisode && rendition !== (this.source?.rendition ?? 'original')) {
        // the picture stays on screen and keeps playing: not a switch the user waits for
        this.update({ pendingRendition: rendition });
      } else {
        this.update({ switching: true });
      }
    }
    void this.loadJob(job);
  }

  private joinGroup(job: Job, group: TransitionGroup): void {
    if (job.group && job.group !== group) job.group.drop(this);
    job.group = group;
    group.add(this);
    if (job.ready) group.settle(this, true);
  }

  private async loadJob(job: Job): Promise<void> {
    let url: string;
    try {
      url =
        job.purpose === 'renew'
          ? await this.env.refreshUrl(job.source.path)
          : await this.env.getUrl(job.source.path);
    } catch (error) {
      if (this.job !== job) return;
      console.warn(`[lerobot] could not resolve ${job.source.path}`, error);
      this.failJob(job);
      return;
    }
    if (this.job !== job || this.disposed) return;
    job.url = url;
    if (job.purpose === 'renew' && url === this.activeUrl) {
      // the source did not re-sign (yet): nothing to swap
      this.cancelJob();
      this.scheduleRenewal();
      return;
    }
    const element = job.element;
    this.presented.delete(element);
    const playing = this.env.mediaSync.isPlaying() && Boolean(this.activeUrl);
    element.preload = job.purpose === 'prefetch' || !this.isVisible() ? 'metadata' : 'auto';
    if (element.getAttribute('src') !== url) {
      element.src = url;
    }
    let frame = job.frame;
    const sameEpisode =
      this.source !== null && Math.abs(this.source.start - job.source.start) < 1e-6;
    // (a frozen camera has no clock of its own: it loads at the playhead and catches up on promotion)
    if (playing && job.purpose !== 'prefetch' && sameEpisode && this.frozenFrame === null) {
      // the same episode in another rendition or under a renewed URL, while playing: prepare
      // ahead of the clock and promote when it gets there
      const lead = RENDEZVOUS_LEAD_SECONDS * Math.max(1, this.active.playbackRate);
      const ahead = this.active.currentTime + lead;
      job.rendezvous = ahead;
      frame = Math.max(0, Math.floor((ahead - job.source.start) * this.env.fps()));
      job.frame = frame;
    }
    // seek before the media data is fetched: applied on loadedmetadata
    this.seekerOf(element).seek(this.frameTime(job.source, frame, element));
    this.watchFrames(element);
    this.waitReady(job);
  }

  /** Track the media time of frames the element presents (requestVideoFrameCallback). */
  private watchFrames(element: HTMLVideoElement): void {
    const video = element as FrameCallbackVideo;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    if (this.frameCallbacks.has(element)) return;
    const loop: VideoFrameCallback = (_now, metadata) => {
      this.presented.set(element, metadata.mediaTime);
      if (this.disposed) return;
      this.frameCallbacks.set(element, video.requestVideoFrameCallback!(loop));
    };
    this.frameCallbacks.set(element, video.requestVideoFrameCallback(loop));
  }

  private waitReady(job: Job): void {
    const element = job.element;
    const seeker = this.seekerOf(element);
    const hasFrameCallback =
      typeof (element as FrameCallbackVideo).requestVideoFrameCallback === 'function';
    let settledAt: number | null = null;
    job.watching = true;
    const check = () => {
      if (this.job !== job || job.failed || this.disposed || job.ready) {
        job.watching = false;
        return;
      }
      const target = seeker.pendingTarget;
      if (target === null && !element.seeking && element.readyState >= HAVE_CURRENT_DATA) {
        settledAt ??= performance.now();
        const presented = this.presented.get(element);
        const fps = this.env.fps();
        const goal = this.frameTime(job.source, job.frame, element);
        const presentedOk =
          presented !== undefined && Math.abs(presented + 0.5 / fps - goal) <= 1 / fps;
        // presented frame confirmed, or the element is not composited (no callback within 250 ms)
        if (!hasFrameCallback || presentedOk || performance.now() - settledAt > 250) {
          job.watching = false;
          this.onJobReady(job);
          return;
        }
      } else {
        settledAt = null;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  private onJobReady(job: Job): void {
    job.ready = true;
    job.readyLatency = performance.now() - job.aimedAt;
    if (job.purpose === 'prefetch') {
      job.resolve(true);
      return; // promoted when the episode is selected
    }
    if (job.group) {
      job.group.settle(this, true);
      return;
    }
    this.finishWhenReady(job);
  }

  /** Promote a ready job now, or at its rendezvous with the playing clock. */
  private finishWhenReady(job: Job): void {
    if (!job.ready) return; // onJobReady calls back
    if (job.rendezvous === null || !this.activeUrl) {
      this.promote(job);
      return;
    }
    const wait = () => {
      if (this.job !== job || this.disposed) return;
      const active = this.active;
      const element = job.element;
      const fps = this.env.fps();
      if (active.paused || !this.env.mediaSync.isPlaying()) {
        // playback stopped meanwhile: show the frame the old element stopped on
        this.stopPreroll(job);
        job.rendezvous = null;
        this.retarget(job, this.currentFrame());
        return;
      }
      if (job.prerolling) {
        // The standby plays (hidden, muted) ahead of the clock, so the browser keeps downloading
        // it as it would for the picture on screen (a paused element stops after a second or two).
        if (this.canSustain(job)) {
          // enough buffered to play on: wait for the clock where it is
          this.stopPreroll(job);
          job.rendezvous = element.currentTime;
        } else if (active.currentTime >= element.currentTime - 0.5 / fps) {
          // the clock caught up with it: the link does not carry this file at this rate (yet)
          this.stopPreroll(job);
          job.overtaken += 1;
          if (job.overtaken >= MAX_OVERTAKEN && job.purpose === 'show') {
            this.cancelJob();
            this.env.onSwitchStarved?.(this);
            return;
          }
          // further ahead each time: the standby needs a head start to fill its buffer
          const lead = Math.min(10, PREROLL_LEAD_SECONDS * 2 ** (job.overtaken - 1));
          job.rendezvous =
            active.currentTime +
            Math.max(lead, this.reaimLead(job, active.playbackRate)) *
              Math.max(1, active.playbackRate);
          this.retarget(job, Math.max(0, Math.floor((job.rendezvous - job.source.start) * fps)));
          return;
        } else if (performance.now() - (job.prerollSince ?? performance.now()) > PREROLL_MAX_MS) {
          // it plays along but its buffer does not grow: the link carries this file at about its
          // bit rate and no faster; on screen it would stall at the first hiccup
          this.stopPreroll(job);
          if (job.purpose === 'show') {
            this.cancelJob();
            this.env.onSwitchStarved?.(this);
            return;
          }
          requestAnimationFrame(wait);
          return;
        } else {
          requestAnimationFrame(wait);
          return;
        }
      }
      const rendezvous = job.rendezvous ?? 0;
      if (active.currentTime > rendezvous + 2 / fps) {
        // the standby got ready after the clock passed it: aim further ahead, by what getting
        // ready took (a slow link, a heavy rendition), and meet the clock there
        const lead = this.reaimLead(job, active.playbackRate);
        job.rendezvous = active.currentTime + lead;
        this.retarget(job, Math.max(0, Math.floor((job.rendezvous - job.source.start) * fps)));
        return;
      }
      if (!this.canSustain(job)) {
        // ahead of the clock but short of data: play it along until it holds enough
        this.startPreroll(job, active.playbackRate);
        requestAnimationFrame(wait);
        return;
      }
      if (active.currentTime >= rendezvous - 0.5 / fps) {
        this.promote(job);
        return;
      }
      if (active.currentTime < rendezvous - 3 - SUSTAIN_AHEAD_SECONDS) {
        // the clock jumped back (a seek): prepare again
        this.startJob(job.purpose, job.source, this.currentFrame(), null);
        return;
      }
      requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  }

  private startPreroll(job: Job, rate: number): void {
    if (job.prerolling) return;
    job.prerolling = true;
    job.prerollSince ??= performance.now();
    const element = job.element;
    element.playbackRate = rate > 0 ? rate : 1;
    try {
      const pending = element.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
    } catch {
      // a refused play shows up as the clock catching up
    }
  }

  private stopPreroll(job: Job): void {
    if (!job.prerolling) return;
    job.prerolling = false;
    job.element.pause();
  }

  /** How far ahead of the clock to aim again: by what getting ready took (a slow link, a heavy rendition). */
  private reaimLead(job: Job, rate: number): number {
    const seconds = ((job.readyLatency ?? 600) / 1000) * 1.5 * Math.max(1, rate);
    return Math.min(10, Math.max(RENDEZVOUS_LEAD_SECONDS, seconds));
  }

  /** The standby has enough media past its frame to play on without a stall. */
  private canSustain(job: Job): boolean {
    const element = job.element;
    const rate = Math.max(1, this.active.playbackRate);
    const end =
      job.source.end !== null && job.source.end > job.source.start
        ? job.source.end
        : Number.isFinite(element.duration)
          ? element.duration
          : Number.POSITIVE_INFINITY;
    const need = Math.min(
      SUSTAIN_AHEAD_SECONDS * rate,
      end - element.currentTime - 0.5 / this.env.fps(),
    );
    return need <= 0 || bufferedAhead(element, element.currentTime) >= need;
  }

  /** Called by a transition group once every member is ready. */
  promoteGroupJob(group: TransitionGroup): void {
    const job = this.job;
    if (!job || job.group !== group || !job.ready) return;
    job.group = null;
    this.finishWhenReady(job);
  }

  private promote(job: Job): void {
    if (this.job !== job || !job.url) return;
    const previous = this.active;
    const wasPlaying = this.env.mediaSync.isPlaying() && !previous.paused;
    this.activeIndex = this.elements.indexOf(job.element);
    this.job = null;
    this.activeUrl = job.url;
    this.source = job.source;
    this.applyRoles();
    this.unfreeze();
    this.active.preload = this.isVisible() ? 'auto' : 'metadata';
    previous.pause();
    // the old element is behind the new one now; free its connection and decoder
    releaseMediaElement(previous);
    this.seekerOf(previous).cancel();
    this.update({
      status: 'ready',
      switching: false,
      rendition: job.source.rendition ?? 'original',
      pendingRendition: null,
      errorCode: null,
      path: job.source.path,
      width: this.active.videoWidth,
      height: this.active.videoHeight,
      start: job.source.start,
      end: job.source.end,
      buffering: false,
    });
    this.refreshSyncRegistration();
    if (wasPlaying || this.env.mediaSync.isPlaying()) this.env.mediaSync.refresh(this.key);
    this.scheduleRenewal();
    this.paintMirrors();
    job.resolve(true);
    this.env.onPromoted?.(this);
  }

  private cancelJob(): void {
    const job = this.job;
    if (!job) return;
    this.job = null;
    job.group?.drop(this);
    job.resolve(false);
    this.seekerOf(job.element).cancel();
    releaseMediaElement(job.element);
    if (this.snapshot.switching || this.snapshot.pendingRendition)
      this.update({ switching: false, pendingRendition: null });
  }

  private failJob(job: Job): void {
    if (this.job !== job) return;
    job.failed = true;
    job.group?.settle(this, false);
    const purpose = job.purpose;
    this.job = null;
    if (this.snapshot.pendingRendition) this.update({ pendingRendition: null });
    job.resolve(false);
    releaseMediaElement(job.element);
    if (purpose === 'prefetch') return; // the real switch loads it again
    void this.handleFailure(job.source, job.frame, job.url, purpose);
  }

  // ---------------------------------------------------------------- errors and URLs

  private async handleFailure(
    source: CameraSource,
    frame: number,
    url: string | null,
    purpose: JobPurpose,
  ): Promise<void> {
    const delay = this.retry.next();
    if (delay === null) {
      this.update({
        status: 'error',
        switching: false,
        buffering: false,
        errorCode: this.snapshot.errorCode ?? 'VIDEO_UNAVAILABLE',
      });
      return;
    }
    const expiry = this.env.getUrlExpiry(source.path);
    let refused = expiry !== null && Date.now() >= expiry - 5_000;
    if (!refused && url) {
      const status = await this.env.probe(url);
      if (this.disposed) return;
      refused = status !== null && isSignatureRefused(status);
    }
    const retry = () => {
      this.retryTimer = null;
      if (this.disposed) return;
      if (this.activeUrl && this.source?.path === source.path) this.swapUrl('recover');
      else this.startJob(purpose === 'prefetch' ? 'show' : purpose, source, frame, null);
    };
    if (refused) {
      // an expired signature: re-sign and retry at once (still counted against the budget)
      this.update({ errorCode: 'VIDEO_URL_REFUSED' });
      try {
        await this.env.invalidateUrl(source.path);
      } catch {
        // the next getUrl reports it
      }
      if (this.disposed) return;
      this.retryTimer = window.setTimeout(retry, 0);
      return;
    }
    this.update({ errorCode: 'VIDEO_UNAVAILABLE' });
    this.retryTimer = window.setTimeout(retry, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Try again after the camera gave up (the error state's retry button). */
  retryNow(): void {
    this.retry.reset();
    this.clearRetry();
    if (!this.source && !this.job) return;
    const source = this.source;
    this.update({ status: this.activeUrl ? 'ready' : 'loading', errorCode: null });
    if (source) this.startJob('recover', source, this.currentFrame(), null);
  }

  private scheduleRenewal(): void {
    if (this.renewTimer !== null) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    if (!this.source || !this.activeUrl) return;
    const expiry = this.env.getUrlExpiry(this.source.path);
    if (expiry === null) return;
    const delay = Math.max(1_000, expiry - VIDEO_URL_POLICY.renewLeadMs - Date.now());
    this.renewTimer = window.setTimeout(() => {
      this.renewTimer = null;
      if (this.disposed || !this.source) return;
      if (this.job && this.job.purpose !== 'prefetch') {
        this.scheduleRenewal(); // a swap is running; it loads a fresh URL anyway
        return;
      }
      this.swapUrl('renew');
    }, delay);
  }

  private listen(element: HTMLVideoElement): void {
    const isActive = () => element === this.active;
    const onWaiting = () => {
      // a frozen camera let its element go on purpose; the cover shows its picture
      if (isActive() && this.activeUrl && this.frozenFrame === null)
        this.update({ buffering: true });
    };
    const onSeeking = () => {
      if (isActive() && element.readyState < HAVE_FUTURE_DATA) this.update({ buffering: true });
    };
    const onReady = () => {
      if (isActive()) this.update({ buffering: false });
      if (isActive()) this.paintMirrors();
    };
    const onLoadedMetadata = () => {
      if (isActive()) this.update({ width: element.videoWidth, height: element.videoHeight });
    };
    const onError = () => {
      if (this.disposed || !element.getAttribute('src')) return;
      const job = this.job;
      if (job && job.element === element) {
        this.failJob(job);
        return;
      }
      if (isActive() && this.source && this.activeUrl) {
        // the source on screen failed mid-playback (an expired URL, a dropped connection)
        void this.handleFailure(this.source, this.currentFrame(), this.activeUrl, 'recover');
      }
    };
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('seeking', onSeeking);
    element.addEventListener('emptied', onWaiting);
    element.addEventListener('loadstart', onWaiting);
    for (const event of ['canplay', 'canplaythrough', 'playing', 'seeked', 'loadeddata']) {
      element.addEventListener(event, onReady);
    }
    element.addEventListener('loadedmetadata', onLoadedMetadata);
    element.addEventListener('error', onError);
  }

  // ---------------------------------------------------------------- panels and visibility

  /** Show the camera in `host` (a panel). A second panel of the same camera mirrors the first. */
  attach(host: HTMLElement): () => void {
    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    this.hosts.push(host);
    this.placeElements();
    this.observe(host);
    return () => this.detach(host);
  }

  private detach(host: HTMLElement): void {
    this.hosts = this.hosts.filter((candidate) => candidate !== host);
    this.observer?.unobserve(host);
    this.resizeObserver?.unobserve(host);
    this.intersecting.delete(host);
    this.sized.delete(host);
    this.visibleHosts.delete(host);
    const mirror = this.mirrors.get(host);
    if (mirror) {
      mirror.remove();
      this.mirrors.delete(host);
    }
    this.placeElements();
    this.onVisibilityChange();
    if (this.hosts.length === 0 && !this.disposed) {
      // a layout rebuild re-attaches within a frame; a closed panel releases the source
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = null;
        if (this.hosts.length === 0) this.releaseSources();
      }, PARK_RELEASE_MS);
    }
  }

  /**
   * Paused, a swap of file loads while the old picture stays: paint it on a canvas and let the old
   * element go, so its connection is free for the new file (browsers open about six connections
   * per host; four cameras on screen plus four loading would leave two waiting).
   */
  private freeze(always = false): void {
    const video = this.active;
    const owner = this.hosts[0];
    if (this.frozenFrame !== null || !owner) return;
    const hasPicture =
      video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
    if (!hasPicture && !always) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1;
    canvas.height = video.videoHeight || 1;
    try {
      if (hasPicture) canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      if (!always) return; // no picture to hold: keep the element
    }
    canvas.dataset.lerobotCover = this.key;
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      zIndex: '2',
      pointerEvents: 'none',
    });
    owner.appendChild(canvas);
    this.cover = canvas;
    this.frozenFrame = this.currentFrame();
    this.activeSeeker.cancel();
    releaseMediaElement(video);
  }

  private unfreeze(): void {
    this.cover?.remove();
    this.cover = null;
    this.frozenFrame = null;
  }

  /** The elements live in the first panel; further panels get a mirror canvas. */
  private placeElements(): void {
    const owner = this.hosts[0] ?? this.env.parking();
    for (const element of this.elements) {
      if (element.parentElement !== owner) owner.appendChild(element);
    }
    if (this.cover && this.cover.parentElement !== owner) owner.appendChild(this.cover);
    for (const host of this.hosts.slice(1)) {
      if (!this.mirrors.has(host)) {
        const canvas = document.createElement('canvas');
        canvas.dataset.lerobotMirror = this.key;
        Object.assign(canvas.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        });
        host.appendChild(canvas);
        this.mirrors.set(host, canvas);
      }
    }
    for (const [host, canvas] of this.mirrors) {
      if (host === this.hosts[0]) {
        canvas.remove();
        this.mirrors.delete(host);
      }
    }
    this.runMirrors();
  }

  private runMirrors(): void {
    const video = this.active as FrameCallbackVideo;
    if (this.mirrors.size === 0) {
      if (this.mirrorHandle !== null) video.cancelVideoFrameCallback?.(this.mirrorHandle);
      this.mirrorHandle = null;
      return;
    }
    this.paintMirrors();
    if (this.mirrorHandle !== null || typeof video.requestVideoFrameCallback !== 'function') return;
    const loop = () => {
      this.mirrorHandle = null;
      if (this.disposed || this.mirrors.size === 0) return;
      this.paintMirrors();
      const current = this.active as FrameCallbackVideo;
      this.mirrorHandle = current.requestVideoFrameCallback?.(loop) ?? null;
    };
    this.mirrorHandle = video.requestVideoFrameCallback(loop);
  }

  private paintMirrors(): void {
    if (this.mirrors.size === 0) return;
    const video = this.active;
    if (video.readyState < HAVE_CURRENT_DATA || !video.videoWidth) return;
    for (const canvas of this.mirrors.values()) {
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  }

  private observe(host: HTMLElement): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.visibleHosts.add(host);
      this.onVisibilityChange();
      return;
    }
    this.observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (entry.isIntersecting && entry.intersectionRatio > 0) this.intersecting.add(target);
        else this.intersecting.delete(target);
      }
      this.updateVisibleHosts();
    });
    // a panel collapsed to nothing (another one maximized) still "intersects", with zero area
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver ??= new ResizeObserver((entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const { width, height } = entry.contentRect;
          if (width > 1 && height > 1) this.sized.add(target);
          else this.sized.delete(target);
        }
        this.updateVisibleHosts();
      });
      this.resizeObserver.observe(host);
    } else {
      this.sized.add(host);
    }
    this.observer.observe(host);
  }

  private updateVisibleHosts(): void {
    const before = this.visibleHosts.size;
    const had = new Set(this.visibleHosts);
    this.visibleHosts.clear();
    for (const host of this.hosts) {
      if (this.intersecting.has(host) && this.sized.has(host)) this.visibleHosts.add(host);
    }
    const same =
      before === this.visibleHosts.size && [...this.visibleHosts].every((host) => had.has(host));
    if (!same) this.onVisibilityChange();
  }

  /** Visible cameras download ahead and join playback; hidden ones only keep metadata. */
  private onVisibilityChange(): void {
    const visible = this.isVisible();
    if (this.hibernateTimer !== null) {
      clearTimeout(this.hibernateTimer);
      this.hibernateTimer = null;
    }
    if (!visible && this.hosts.length > 0 && this.activeUrl && this.source) {
      // Hidden for a while (another camera maximized, scrolled away; not a layout rebuild that
      // shows it again at once): stop downloading. A paused or playing element keeps buffering
      // whatever its preload says; only letting go of it stops that. Its last picture stays on a
      // cover until it is shown again and reloads at the playhead.
      this.hibernateTimer = window.setTimeout(() => {
        this.hibernateTimer = null;
        if (this.disposed || this.isVisible() || this.hosts.length === 0 || !this.activeUrl) return;
        if (this.job && this.job.purpose !== 'show') this.cancelJob();
        if (!this.job) this.freeze(true);
      }, HIBERNATE_MS);
    } else if (visible && this.frozenFrame !== null && !this.job && this.source) {
      this.startJob('show', this.source, this.env.frameIndex(), null);
    }
    this.active.preload = visible ? 'auto' : 'metadata';
    if (this.job && this.job.purpose !== 'prefetch')
      this.job.element.preload = visible ? 'auto' : 'metadata';
    this.refreshSyncRegistration();
    this.env.onVisibilityChange?.(this);
  }

  /** Join MediaSync while a source is on screen and the camera is visible. */
  private refreshSyncRegistration(): void {
    const shouldRegister = Boolean(this.activeUrl && this.source && this.isVisible());
    if (shouldRegister && !this.unregisterSync) {
      if (!this.env.mediaSync.isPlaying() && !this.job) {
        // shown again while paused: catch up with the playhead
        this.seekActive(this.env.frameIndex(), false);
      }
      this.unregisterSync = this.env.mediaSync.register(this.key, this.syncedMedia);
    } else if (!shouldRegister && this.unregisterSync) {
      this.unregisterSync();
      this.unregisterSync = null;
    }
  }

  private applyRoles(): void {
    const [active, standby] = [this.active, this.standby];
    active.style.zIndex = '1';
    active.style.visibility = 'visible';
    active.removeAttribute('aria-hidden');
    active.dataset.lerobotRole = 'active';
    standby.style.zIndex = '0';
    standby.setAttribute('aria-hidden', 'true');
    standby.dataset.lerobotRole = 'standby';
  }

  /** Drop both sources (no panel shows this camera any more). Showing it again reloads. */
  releaseSources(): void {
    this.cancelJob();
    this.clearRetry();
    if (this.renewTimer !== null) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    this.unregisterSync?.();
    this.unregisterSync = null;
    for (const element of this.elements) releaseMediaElement(element);
    this.unfreeze();
    this.activeUrl = null;
    this.update({ status: this.source ? 'empty' : this.snapshot.status, buffering: false });
  }

  /**
   * The rendition this camera shows, or is switching to (a prefetch or URL renewal keeps the
   * current one); null before the first source.
   */
  wantedRendition(): Rendition | null {
    const job = this.job;
    if (job && (job.purpose === 'show' || job.purpose === 'recover'))
      return job.source.rendition ?? 'original';
    if (!this.source) return null;
    return this.source.rendition ?? 'original';
  }

  /** Elements that may download, with the file each loads (link measurement). */
  streams(): Array<{ element: HTMLVideoElement; path: string }> {
    const streams: Array<{ element: HTMLVideoElement; path: string }> = [];
    if (this.activeUrl && this.source && this.frozenFrame === null)
      streams.push({ element: this.active, path: this.source.path });
    if (this.job?.url) streams.push({ element: this.job.element, path: this.job.source.path });
    return streams;
  }

  /** A swap (not a prefetch or URL renewal) loads in the standby element. */
  isSwitching(): boolean {
    return this.job !== null && (this.job.purpose === 'show' || this.job.purpose === 'recover');
  }

  /** The other rendition of the episode on screen loads in the standby element. */
  isUpgrading(): boolean {
    return this.snapshot.pendingRendition === 'original';
  }

  /** Duration of `path` when one of the elements has loaded it. */
  mediaDuration(path: string): number | null {
    const candidates: HTMLVideoElement[] = [];
    if (this.activeUrl && this.source?.path === path && this.frozenFrame === null)
      candidates.push(this.active);
    if (this.job?.source.path === path) candidates.push(this.job.element);
    for (const element of candidates) {
      if (Number.isFinite(element.duration) && element.duration > 0) return element.duration;
    }
    return null;
  }

  /** Whether the element on screen shows `source` (or loads it in the standby element). */
  hasSource(): boolean {
    return Boolean(this.activeUrl || this.job);
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseSources();
    this.disposed = true;
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    if (this.hibernateTimer !== null) clearTimeout(this.hibernateTimer);
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.seekers.forEach((seeker) => seeker.dispose());
    for (const canvas of this.mirrors.values()) canvas.remove();
    this.mirrors.clear();
    for (const element of this.elements) element.remove();
    this.listeners.clear();
  }
}
