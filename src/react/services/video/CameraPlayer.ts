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

/** One camera's view of an episode: the file and the episode's time range in it. */
export interface CameraSource {
  path: string;
  /** `from_timestamp` of the episode in this file (s). */
  start: number;
  /** `to_timestamp` (s), or null when unknown (the file's duration is used). */
  end: number | null;
}

export type CameraErrorCode = 'VIDEO_UNAVAILABLE' | 'VIDEO_URL_REFUSED';

export interface CameraSnapshot {
  /** No source yet / first source loading / showing a frame / gave up. */
  status: 'empty' | 'loading' | 'ready' | 'error';
  /** Waiting for data on the element on screen (playback or a seek). */
  buffering: boolean;
  /** A swap (episode, quality, URL) is loading in the standby element. */
  switching: boolean;
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
/** URL renewal; `renewLeadMs` before the expiry the URL is re-signed and swapped in (tests shorten it). */
export const VIDEO_URL_POLICY = { renewLeadMs: 90_000 };
/** Elements without a panel for this long release their source. */
const PARK_RELEASE_MS = 3_000;
/** While playing, a swap is prepared this far ahead of the clock and promoted when it gets there. */
const RENDEZVOUS_LEAD_SECONDS = 0.6;

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
  private unregisterSync: (() => void) | null = null;
  private readonly syncedMedia: SyncedMedia;
  private disposed = false;
  private readonly frameCallbacks = new WeakMap<HTMLVideoElement, number>();
  private readonly mirrors = new Map<HTMLElement, HTMLCanvasElement>();
  private mirrorHandle: number | null = null;

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

    if (this.activeUrl && this.source?.path === source.path) {
      this.cancelJob();
      this.source = source;
      this.update({ start: source.start, end: source.end, switching: false });
      this.seekActive(frame, false);
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
      group: null,
      startedAt: performance.now(),
    };
    this.job = job;
    if (group) this.joinGroup(job, group);
    if (!this.activeUrl) this.update({ status: 'loading', path: source.path });
    else if (purpose === 'show') this.update({ switching: true });
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
    if (playing && job.purpose !== 'prefetch' && sameEpisode) {
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
      const fps = this.env.fps();
      if (active.paused || !this.env.mediaSync.isPlaying()) {
        // playback stopped meanwhile: show the frame the old element stopped on
        job.rendezvous = null;
        this.retarget(job, this.currentFrame());
        return;
      }
      const rendezvous = job.rendezvous ?? 0;
      if (active.currentTime > rendezvous + 2 / fps) {
        // the standby got ready after the clock passed it: aim further ahead, by what getting
        // ready took (a slow link, a heavy rendition), and meet the clock there
        const seconds = ((job.readyLatency ?? 600) / 1000) * 1.5 * Math.max(1, active.playbackRate);
        const lead = Math.min(10, Math.max(RENDEZVOUS_LEAD_SECONDS, seconds));
        job.rendezvous = active.currentTime + lead;
        this.retarget(job, Math.max(0, Math.floor((job.rendezvous - job.source.start) * fps)));
        return;
      }
      if (active.currentTime >= rendezvous - 0.5 / fps) {
        this.promote(job);
        return;
      }
      if (active.currentTime < (job.rendezvous ?? 0) - 3) {
        // the clock jumped back (a seek): prepare again
        this.startJob(job.purpose, job.source, this.currentFrame(), null);
        return;
      }
      requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
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
    this.active.preload = this.isVisible() ? 'auto' : 'metadata';
    previous.pause();
    // the old element is behind the new one now; free its connection and decoder
    releaseMediaElement(previous);
    this.seekerOf(previous).cancel();
    this.update({
      status: 'ready',
      switching: false,
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
  }

  private cancelJob(): void {
    const job = this.job;
    if (!job) return;
    this.job = null;
    job.group?.drop(this);
    job.resolve(false);
    this.seekerOf(job.element).cancel();
    releaseMediaElement(job.element);
    if (this.snapshot.switching) this.update({ switching: false });
  }

  private failJob(job: Job): void {
    if (this.job !== job) return;
    job.failed = true;
    job.group?.settle(this, false);
    const purpose = job.purpose;
    this.job = null;
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
      if (isActive() && this.activeUrl) this.update({ buffering: true });
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

  /** The elements live in the first panel; further panels get a mirror canvas. */
  private placeElements(): void {
    const owner = this.hosts[0] ?? this.env.parking();
    for (const element of this.elements) {
      if (element.parentElement !== owner) owner.appendChild(element);
    }
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
        if (entry.isIntersecting && entry.intersectionRatio > 0) this.visibleHosts.add(target);
        else this.visibleHosts.delete(target);
      }
      this.onVisibilityChange();
    });
    this.observer.observe(host);
  }

  /** Visible cameras download ahead and join playback; hidden ones only keep metadata. */
  private onVisibilityChange(): void {
    const visible = this.isVisible();
    this.active.preload = visible ? 'auto' : 'metadata';
    if (this.job && this.job.purpose !== 'prefetch')
      this.job.element.preload = visible ? 'auto' : 'metadata';
    this.refreshSyncRegistration();
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
    this.activeUrl = null;
    this.update({ status: this.source ? 'empty' : this.snapshot.status, buffering: false });
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
    this.observer?.disconnect();
    this.seekers.forEach((seeker) => seeker.dispose());
    for (const canvas of this.mirrors.values()) canvas.remove();
    this.mirrors.clear();
    for (const element of this.elements) element.remove();
    this.listeners.clear();
  }
}
