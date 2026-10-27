/**
 * The cameras of one viewer: which file and time range each shows for the selected episode, the
 * preview / original rendition, paused seeks and scrubbing, next-episode prefetch, and the panels
 * that display them. Lives as long as the viewer's data provider; panels attach to it.
 */

import type { LeRobotInfo } from '@/core';
import type { LeRobotDataLoader } from '@/platform';
import type { MediaSync } from '../MediaSync';
import {
  CameraPlayer,
  TransitionGroup,
  type CameraSource,
  type PlayerEnvironment,
} from './CameraPlayer';
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry';

export type VideoVariantKind = 'preview' | 'original';

/** Start the next episode's prefetch when playback is this close to the end (s, scaled by rate). */
export const PREFETCH_LEAD_SECONDS = 12;
/** Paused: prefetch after this long without a new selection or seek (ms). */
const PREFETCH_IDLE_MS = 800;

/** Probe a URL with a one-byte Range request: the HTTP status, or null (network error, not HTTP). */
async function probeUrl(url: string): Promise<number | null> {
  if (!/^https?:/i.test(url)) return null;
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return null;
  }
}

export class VideoStage {
  private loader: LeRobotDataLoader | null = null;
  private info: LeRobotInfo | null = null;
  private episodeIndex: number | null = null;
  private variant: VideoVariantKind = 'original';
  private previewTemplate: string | null = null;
  private readonly players = new Map<string, CameraPlayer>();
  private readonly previewExists = new Map<string, boolean | Promise<boolean>>();
  private scrubbing = false;
  private resolving = false;
  private token = 0;
  private parkingElement: HTMLElement | null = null;
  private prefetchWanted: number | null = null;
  private prefetchStarted: number | null = null;
  private prefetchTimer: number | null = null;
  private lastActivity = 0;
  private unsubscribeFrames: (() => void) | null = null;
  /** Tests shorten the retry delays. */
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY;

  private readonly mediaSync: MediaSync;
  private readonly getFrameIndex: () => number;

  constructor(mediaSync: MediaSync, getFrameIndex: () => number) {
    this.mediaSync = mediaSync;
    this.getFrameIndex = getFrameIndex;
  }

  /** Follow the playhead: paused seeks and scrubbing (playing frames come from the videos). */
  connectFrames(subscribe: (callback: (frame: number) => void) => () => void): () => void {
    this.unsubscribeFrames?.();
    this.unsubscribeFrames = subscribe((frame) => this.onFrame(frame));
    return () => {
      this.unsubscribeFrames?.();
      this.unsubscribeFrames = null;
    };
  }

  /** A new dataset (or none): every camera drops its sources. */
  setDataset(loader: LeRobotDataLoader | null, info: LeRobotInfo | null): void {
    if (this.loader === loader && this.info === info) return;
    this.token += 1;
    this.loader = loader;
    this.info = info;
    this.episodeIndex = null;
    this.previewExists.clear();
    this.cancelPrefetch();
    for (const [key, player] of this.players) {
      // cameras of the previous dataset that no panel shows any more go away
      if (player.hostCount() === 0) {
        player.dispose();
        this.players.delete(key);
      } else {
        player.releaseSources();
      }
    }
  }

  setVariant(previewTemplate: string | null, variant: VideoVariantKind): void {
    const template = previewTemplate?.trim() || null;
    if (template === this.previewTemplate && variant === this.variant) return;
    const templateChanged = template !== this.previewTemplate;
    this.previewTemplate = template;
    this.variant = variant;
    if (templateChanged) this.previewExists.clear();
    this.cancelPrefetch();
    if (this.episodeIndex === null) return;
    // latest intent wins: a toggle while the previous one loads supersedes it
    this.showEpisode(this.episodeIndex);
  }

  getVariant(): VideoVariantKind {
    return this.variant;
  }

  /**
   * Switch every camera to `episodeIndex` at the playhead (set the frame index first). Call before
   * notifying the new frame index, so no camera seeks the old episode's file to the new frame.
   */
  selectEpisode(episodeIndex: number): void {
    this.lastActivity = performance.now();
    if (this.prefetchWanted !== episodeIndex) this.cancelPrefetch();
    this.prefetchWanted = null;
    this.prefetchStarted = null;
    this.episodeIndex = episodeIndex;
    this.showEpisode(episodeIndex);
  }

  /** Show the selected episode at the playhead again (loop): through a prefetched standby when there is one. */
  restartEpisode(): void {
    if (this.episodeIndex === null) return;
    this.prefetchWanted = null;
    this.prefetchStarted = null;
    this.showEpisode(this.episodeIndex);
  }

  /**
   * Playback stopped: the videos paused wherever they were, maybe a frame past the last clock tick.
   * Put every camera exactly on the playhead frame.
   */
  alignToPlayhead(): void {
    if (this.mediaSync.isActive() || this.resolving) return;
    const frame = this.getFrameIndex();
    for (const player of this.players.values()) player.seekFrame(frame, false, true);
  }

  setScrubbing(scrubbing: boolean): void {
    if (this.scrubbing === scrubbing) return;
    this.scrubbing = scrubbing;
    // release: the exact seek of the final position
    if (!scrubbing) this.onFrame(this.getFrameIndex());
  }

  /**
   * Prefetch `episodeIndex` (the next one, or the selected one for a loop) once it is cheap: paused
   * and idle, or playing close to the end of the current episode.
   */
  schedulePrefetch(episodeIndex: number | null): void {
    this.prefetchWanted = episodeIndex;
    this.prefetchStarted = null;
    if (episodeIndex === null) {
      this.cancelPrefetch();
      return;
    }
    if (this.prefetchTimer === null) {
      this.prefetchTimer = window.setInterval(() => this.maybePrefetch(), 250);
    }
  }

  private cancelPrefetch(): void {
    this.prefetchWanted = null;
    this.prefetchStarted = null;
    if (this.prefetchTimer !== null) {
      clearInterval(this.prefetchTimer);
      this.prefetchTimer = null;
    }
    for (const player of this.players.values()) player.cancelPrefetch();
  }

  private maybePrefetch(): void {
    const target = this.prefetchWanted;
    if (target === null || this.prefetchStarted === target || this.episodeIndex === null) return;
    if (!this.isPrefetchTime()) return;
    this.prefetchStarted = target;
    if (this.prefetchTimer !== null) {
      clearInterval(this.prefetchTimer);
      this.prefetchTimer = null;
    }
    void this.prefetchEpisode(target);
  }

  private isPrefetchTime(): boolean {
    if (!this.mediaSync.isPlaying()) {
      return performance.now() - this.lastActivity > PREFETCH_IDLE_MS;
    }
    for (const player of this.players.values()) {
      const source = player.getSource();
      if (!source || !player.isVisible()) continue;
      const end = source.end ?? player.active.duration;
      if (!Number.isFinite(end)) continue;
      const remaining =
        (end - player.active.currentTime) / Math.max(0.1, player.active.playbackRate);
      return remaining < PREFETCH_LEAD_SECONDS;
    }
    return false;
  }

  private async prefetchEpisode(episodeIndex: number): Promise<void> {
    const token = this.token;
    const frame = 0;
    for (const player of this.players.values()) {
      if (!player.isVisible()) continue;
      const source = await this.sourceFor(player.key, episodeIndex);
      if (token !== this.token || this.prefetchStarted !== episodeIndex) return;
      if (source) player.prefetch(source, frame);
    }
  }

  /** Attach a panel's media host for `featureKey`; returns the detach function. */
  attach(featureKey: string, host: HTMLElement): () => void {
    const player = this.player(featureKey);
    const detach = player.attach(host);
    if (!player.hasSource() && this.episodeIndex !== null) {
      const episodeIndex = this.episodeIndex;
      const token = this.token;
      void Promise.resolve(this.sourceFor(featureKey, episodeIndex)).then((source) => {
        if (
          source &&
          token === this.token &&
          this.episodeIndex === episodeIndex &&
          !player.hasSource()
        ) {
          player.show(source, this.getFrameIndex(), null);
        }
      });
    }
    return detach;
  }

  /** The camera of `featureKey` (created on first use). */
  player(featureKey: string): CameraPlayer {
    let player = this.players.get(featureKey);
    if (!player) {
      player = new CameraPlayer(featureKey, this.environment());
      this.players.set(featureKey, player);
    }
    return player;
  }

  /** Cameras created so far (tests and diagnostics). */
  getPlayers(): CameraPlayer[] {
    return [...this.players.values()];
  }

  /**
   * The viewer unmounted: stop every download and decoder. The stage stays usable (React StrictMode
   * mounts twice; a remount attaches the panels again and reloads what they show).
   */
  dispose(): void {
    this.token += 1;
    this.cancelPrefetch();
    for (const [key, player] of this.players) {
      if (player.hostCount() === 0) {
        player.dispose();
        this.players.delete(key);
      } else {
        player.releaseSources();
      }
    }
    this.parkingElement?.remove();
    this.parkingElement = null;
  }

  // ---------------------------------------------------------------- internals

  private onFrame(frame: number): void {
    if (this.mediaSync.isActive()) return; // playing: the videos drive the frame index
    if (this.resolving) return; // a switch is resolving its sources; it seeks to the playhead
    this.lastActivity = performance.now();
    for (const player of this.players.values()) player.seekFrame(frame, this.scrubbing);
  }

  /**
   * Switch the cameras to `episodeIndex` at the playhead. Synchronous when every source is known (the
   * usual case), so a frame notification that follows lands on the new episode; while a preview
   * check is pending, paused seeks wait for it.
   */
  private showEpisode(episodeIndex: number): void {
    const token = ++this.token;
    const group = new TransitionGroup();
    const players = [...this.players.values()].filter(
      (player) => player.hasSource() || player.isVisible(),
    );
    const resolved = players.map((player) => this.sourceFor(player.key, episodeIndex));
    const apply = (sources: Array<CameraSource | null>) => {
      if (token !== this.token) return;
      this.resolving = false;
      const frame = this.getFrameIndex();
      players.forEach((player, index) => {
        const source = sources[index];
        if (source) player.show(source, frame, group);
      });
      group.seal();
    };
    if (resolved.some((source) => source instanceof Promise)) {
      this.resolving = true;
      void Promise.all(resolved).then(apply);
    } else {
      apply(resolved as Array<CameraSource | null>);
    }
  }

  /** The file and time range of `featureKey` for `episodeIndex` in the current rendition. */
  private sourceFor(
    featureKey: string,
    episodeIndex: number,
  ): CameraSource | null | Promise<CameraSource | null> {
    const loader = this.loader;
    if (!loader) return null;
    const original = loader.getEpisodeVideoPath(episodeIndex, featureKey);
    if (!original) return null;
    const base: CameraSource = {
      path: original.path,
      start: original.fromSec ?? 0,
      end: original.toSec && original.toSec > (original.fromSec ?? 0) ? original.toSec : null,
    };
    if (this.variant !== 'preview' || !this.previewTemplate) return base;
    const preview = loader.getEpisodeVideoPath(episodeIndex, featureKey, this.previewTemplate);
    if (!preview || preview.path === base.path) return base;
    const known = this.previewExists.get(preview.path);
    if (known === true) return { ...base, path: preview.path };
    if (known === false) return base;
    const pending =
      known ??
      loader.dataSource
        .exists(preview.path)
        .catch(() => false)
        .then((exists) => {
          this.previewExists.set(preview.path, exists);
          return exists;
        });
    this.previewExists.set(preview.path, pending);
    return pending.then((exists) => (exists ? { ...base, path: preview.path } : base));
  }

  private parking(): HTMLElement {
    if (!this.parkingElement) {
      const element = document.createElement('div');
      element.dataset.lerobotVideoParking = 'true';
      element.setAttribute('aria-hidden', 'true');
      Object.assign(element.style, {
        position: 'fixed',
        left: '-10000px',
        top: '0',
        width: '16px',
        height: '16px',
        overflow: 'hidden',
        pointerEvents: 'none',
      });
      document.body.appendChild(element);
      this.parkingElement = element;
    }
    return this.parkingElement;
  }

  private environment(): PlayerEnvironment {
    const retryPolicy = () => this.retryPolicy;
    return {
      mediaSync: this.mediaSync,
      fps: () => (this.info?.fps && this.info.fps > 0 ? this.info.fps : 30),
      frameIndex: () => this.getFrameIndex(),
      getUrl: (path) => {
        if (!this.loader) return Promise.reject(new Error('No dataset'));
        return this.loader.getFileUrl(path);
      },
      refreshUrl: (path) => {
        if (!this.loader) return Promise.reject(new Error('No dataset'));
        return this.loader.refreshFileUrl(path);
      },
      invalidateUrl: async (path) => {
        await this.loader?.invalidateFileUrl(path);
      },
      getUrlExpiry: (path) => this.loader?.getFileUrlExpiry(path) ?? null,
      parking: () => this.parking(),
      get retryPolicy() {
        return retryPolicy();
      },
      probe: probeUrl,
    };
  }
}
