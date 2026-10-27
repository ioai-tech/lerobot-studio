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
import {
  bufferedAhead,
  measureThroughput,
  planRenditions,
  type Rendition,
  type RenditionPlan,
  LinkEstimate,
} from './quality';

export type VideoVariantKind = Rendition;

/** What the playback bar tells about the rendition the cameras play. */
export interface QualityStatus {
  /** Playing with Original chosen, but some visible cameras keep the preview: the link is too slow. */
  limited: boolean;
  neededMbps: number | null;
  linkMbps: number | null;
  originalCount: number;
  visibleCount: number;
  /** The focused camera plays the original while the others keep the preview. */
  focusedOriginal: boolean;
}

const QUALITY_IDLE: QualityStatus = {
  limited: false,
  neededMbps: null,
  linkMbps: null,
  originalCount: 0,
  visibleCount: 0,
  focusedOriginal: false,
};

/** A link measurement is trusted this long (ms); a stall of an original measures again sooner. */
const LINK_FRESH_MS = 60_000;
/**
 * The link estimate is the best measurement of this window (ms): one short probe under
 * contention (the videos downloading meanwhile, a busy moment of the network) reads low, a link
 * does not get slower than its best recent reading unless playback stalls.
 */
const LINK_SAMPLE_WINDOW_MS = 180_000;
/** After a stall of an original, the next one lowers the estimate again no sooner than this (ms). */
const LINK_STALL_BACKOFF_MS = 5_000;
/** A measurement waits this long at most for the videos to stop downloading (ms). */
const LINK_QUIET_WAIT_MS = 6_000;
/** Playback held this long on a camera playing the original counts as the link falling short (ms). */
const STALL_MS = 1_500;
/** Or held this long in total within the window (ms): short stalls that keep coming. */
const STALL_WINDOW_MS = 10_000;
const STALL_WINDOW_HELD_MS = 2_500;
/** A camera whose original starved stays on the preview this long (ms) with as many cameras shown. */
const STARVED_FOR_MS = 60_000;
/**
 * While playing, a camera starts loading its original only once the videos on screen stopped
 * downloading ahead (a preview fills tens of seconds of buffer at full link speed after it loads),
 * or after this long (ms).
 */
const UPGRADE_SETTLE_MAX_MS = 20_000;
/** A preview with this much buffered (s) has done its initial fill and only tops up. */
const PREVIEW_FILLED_SECONDS = 12;
/** An original with less than this buffered (s) when playback stalls waits for the link. */
const STARVED_AHEAD_SECONDS = 1;

/** Start the next episode's prefetch when playback is this close to the end (s, scaled by rate). */
export const PREFETCH_LEAD_SECONDS = 12;
/** Paused: prefetch after this long without a new selection or seek (ms). */
const PREFETCH_IDLE_MS = 800;

/** A probe that has not answered after this long counts as a network failure (ms). */
const PROBE_TIMEOUT_MS = 5_000;

/** A file size the source could not tell is asked again after this long (ms). */
const SIZE_RETRY_MS = 60_000;

/** Probe a URL with a one-byte Range request: the HTTP status, or null (network error, not HTTP). */
async function probeUrl(url: string): Promise<number | null> {
  if (!/^https?:/i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return null; // no answer in time: treated as a network failure (backoff, no re-sign)
  } finally {
    clearTimeout(timer);
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
  /** An episode switch / a rendition change waits for its sources (paused seeks wait for it). */
  private resolvingEpisode = false;
  private resolvingPlan = false;
  /**
   * Episode switches and rendition changes resolve their sources separately: a rendition change
   * never cancels an episode switch it does not touch, and an episode switch drops a pending
   * rendition change (it shows the planned renditions itself).
   */
  private planToken = 0;
  private replanAfterEpisode = false;
  private token = 0;
  private parkingElement: HTMLElement | null = null;
  private prefetchWanted: number | null = null;
  private prefetchStarted: number | null = null;
  private prefetchTimer: number | null = null;
  private lastActivity = 0;
  private unsubscribeFrames: (() => void) | null = null;
  private playing = false;
  private focusedKey: string | null = null;
  private plan: RenditionPlan | null = null;
  private quality: QualityStatus = QUALITY_IDLE;
  private readonly qualityListeners = new Set<() => void>();
  /** Measured link throughput (bits/s; Infinity for local files), null before a measurement. */
  private linkBps: number | null = null;
  private linkMeasuredAt = 0;
  /** Recent link measurements and the cap of the last stall (held for `LINK_FRESH_MS`). */
  private readonly linkEstimate = new LinkEstimate(LINK_SAMPLE_WINDOW_MS, LINK_FRESH_MS);
  private measuring: Promise<void> | null = null;
  private lastStallAt = 0;
  private stallTimer: number | null = null;
  private heldSince: number | null = null;
  /** Cameras whose original starved while playing, and how many cameras were visible then. */
  private readonly starved = new Map<string, { visible: number; at: number }>();
  private heldSpans: Array<{ at: number; ms: number }> = [];
  private upgradeTimer: number | null = null;
  private upgradeWaitSince: number | null = null;
  /** Playback just started: previews may be loading (see `replan`). */
  private settling = false;
  private settlingSince = 0;
  /** File sizes (bytes) of the originals, or their lookup. */
  private readonly sizes = new Map<string, number | Promise<void>>();
  /** When a size lookup last failed, per path. */
  private readonly sizeMisses = new Map<string, number>();
  /** Media durations (s) seen per file; a file and its other rendition share theirs. */
  private readonly durations = new Map<string, number>();
  /** Measures the link (tests replace it). */
  measureLink: (url: string, offset: number) => Promise<number | null> = (url, offset) =>
    measureThroughput(url, { offset });
  /** Tests shorten the retry delays. */
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY;

  private readonly mediaSync: MediaSync;
  private readonly getFrameIndex: () => number;

  constructor(mediaSync: MediaSync, getFrameIndex: () => number) {
    this.mediaSync = mediaSync;
    this.getFrameIndex = getFrameIndex;
    // the stage lives as long as the media sync (both belong to the data provider)
    mediaSync.onBufferingChange((buffering, switching) => {
      if (this.stallTimer !== null) clearTimeout(this.stallTimer);
      this.stallTimer = null;
      const now = performance.now();
      // waiting for a camera that switches episodes says nothing about the link
      if (buffering && switching) {
        this.heldSince = null;
        return;
      }
      if (buffering) {
        this.heldSince = now;
        // a stall that lasts, not the moment a camera's next data arrives late
        this.stallTimer = window.setTimeout(() => this.onStall(), STALL_MS);
        return;
      }
      if (this.heldSince === null) return;
      // or short stalls that keep coming
      this.heldSpans.push({ at: now, ms: now - this.heldSince });
      this.heldSince = null;
      this.heldSpans = this.heldSpans.filter((span) => now - span.at < STALL_WINDOW_MS);
      const held = this.heldSpans.reduce((sum, span) => sum + span.ms, 0);
      if (held >= STALL_WINDOW_HELD_MS) {
        this.heldSpans = [];
        this.onStall(true);
      }
    });
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
    this.planToken += 1;
    this.resolvingEpisode = false;
    this.resolvingPlan = false;
    this.loader = loader;
    this.info = info;
    this.episodeIndex = null;
    this.previewExists.clear();
    this.sizes.clear();
    this.sizeMisses.clear();
    this.durations.clear();
    this.starved.clear();
    this.linkBps = null;
    this.linkMeasuredAt = 0;
    this.linkEstimate.reset();
    this.plan = null;
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
    this.cancelPrefetch();
    if (templateChanged) {
      this.previewExists.clear();
      this.computePlan();
      if (this.episodeIndex !== null) this.showEpisode(this.episodeIndex);
      return;
    }
    // latest intent wins: a toggle while the previous one loads supersedes it
    this.replan();
  }

  getVariant(): VideoVariantKind {
    return this.variant;
  }

  /** Playback started or stopped: paused cameras show the chosen rendition, playing ones what the link carries. */
  setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.settling = playing;
    this.settlingSince = performance.now();
    this.replan();
  }

  /** A camera was maximized or put in full screen (true), or left it. It gets the original first. */
  setFocusedCamera(featureKey: string, focused: boolean): void {
    const next = focused ? featureKey : this.focusedKey === featureKey ? null : this.focusedKey;
    if (next === this.focusedKey) return;
    this.focusedKey = next;
    this.replan();
  }

  getQualityStatus = (): QualityStatus => this.quality;

  subscribeQuality = (listener: () => void): (() => void) => {
    this.qualityListeners.add(listener);
    return () => this.qualityListeners.delete(listener);
  };

  /** The measured link throughput (bits/s), or null before a measurement. */
  getLinkEstimate(): number | null {
    return this.linkBps;
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
      const source = await this.sourceFor(player.key, episodeIndex, this.renditionFor(player.key));
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
      const rendition = this.renditionFor(featureKey);
      void Promise.resolve(this.sourceFor(featureKey, episodeIndex, rendition)).then((source) => {
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
      // the notice counts what the cameras show: every promotion or demotion updates it
      player.subscribe(() => this.updateOriginalCount());
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
    this.planToken += 1;
    this.resolvingEpisode = false;
    this.resolvingPlan = false;
    this.cancelPrefetch();
    this.playing = false;
    if (this.stallTimer !== null) clearTimeout(this.stallTimer);
    this.stallTimer = null;
    if (this.upgradeTimer !== null) clearTimeout(this.upgradeTimer);
    this.upgradeTimer = null;
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
    // a pending rendition change resolved the old episode's files: this switch shows the plan
    this.planToken += 1;
    this.resolvingPlan = false;
    const group = new TransitionGroup();
    const players = [...this.players.values()].filter(
      (player) => player.hasSource() || player.isVisible(),
    );
    const resolved = players.map((player) =>
      this.sourceFor(player.key, episodeIndex, this.renditionFor(player.key)),
    );
    const apply = (sources: Array<CameraSource | null>) => {
      if (token !== this.token) return;
      this.resolvingEpisode = false;
      const frame = this.getFrameIndex();
      players.forEach((player, index) => {
        const source = sources[index];
        if (source) player.show(source, frame, group);
      });
      group.seal();
      if (this.replanAfterEpisode) {
        // the plan changed while this switch resolved its files
        this.replanAfterEpisode = false;
        this.replan();
      }
    };
    if (resolved.some((source) => source instanceof Promise)) {
      this.resolvingEpisode = true;
      void Promise.all(resolved).then(apply);
    } else {
      apply(resolved as Array<CameraSource | null>);
    }
  }

  // ---------------------------------------------------------------- renditions and the link

  /**
   * Visible cameras whose picture on screen is the original: the same snapshot the panels' badges
   * read, so the playback bar never disagrees with them.
   */
  private countOriginal(): number {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.isVisible() && player.getSnapshot().rendition === 'original') count += 1;
    }
    return count;
  }

  private updateOriginalCount(): void {
    if (!this.quality.limited) return;
    const originalCount = this.countOriginal();
    if (originalCount === this.quality.originalCount) return;
    this.quality = { ...this.quality, originalCount };
    this.qualityListeners.forEach((listener) => listener());
  }

  /** The rendition `featureKey` should show now. */
  private renditionFor(featureKey: string): Rendition {
    return this.plan?.targets.get(featureKey) ?? this.variant;
  }

  private computePlan(): RenditionPlan {
    const players = [...this.players.values()];
    const plan = planRenditions({
      variant: this.previewTemplate ? this.variant : 'original',
      playing: this.playing,
      linkBps: this.linkBps,
      cameras: players.map((player) => ({
        key: player.key,
        visible: player.isVisible(),
        focused: player.key === this.focusedKey,
        originalBps: this.originalBps(player.key),
        previewBps: this.previewBps(player.key),
        current: player.wantedRendition(),
        shown: player.getSnapshot().rendition,
        blocked: this.isStarved(player.key),
      })),
    });
    this.plan = plan;
    const limited = plan.limited && this.playing;
    const next: QualityStatus = limited
      ? {
          limited: true,
          neededMbps: plan.neededBps === null ? null : plan.neededBps / 1e6,
          linkMbps: plan.linkBps === null ? null : plan.linkBps / 1e6,
          originalCount: this.countOriginal(),
          visibleCount: plan.visibleCount,
          focusedOriginal: plan.focusedOriginal,
        }
      : QUALITY_IDLE;
    if (!sameQuality(next, this.quality)) {
      this.quality = next;
      this.qualityListeners.forEach((listener) => listener());
    }
    return plan;
  }

  /**
   * Plan the renditions again and switch the cameras whose rendition changed: paused, together at
   * the playhead; playing, each when its standby can play on.
   */
  private replan(): void {
    const plan = this.computePlan();
    const episodeIndex = this.episodeIndex;
    if (episodeIndex === null || !this.loader) return;
    if (this.wantsOriginal()) {
      // measured once Original is chosen (paused too: ready when playback starts), again when old
      const stale = performance.now() - this.linkMeasuredAt > LINK_FRESH_MS;
      if (this.linkBps === null || (this.playing && stale)) void this.measure();
    }
    const targets = new Map(plan.targets);
    // the previews of this plan start loading after it: judge them from the next check on
    if (
      this.settling &&
      performance.now() - this.settlingSince > 1_000 &&
      !this.previewsDownloading(plan.targets)
    ) {
      this.settling = false;
    }
    if (this.playing && plan.limited && this.settling) {
      // Playback (re)started with some cameras on the preview. A preview that loads fills tens of
      // seconds of buffer at full link speed and would starve an original meanwhile: the cameras
      // that may play the original (but the focused one) play the preview until the previews
      // settled, then switch one at a time.
      for (const player of this.players.values()) {
        if (targets.get(player.key) === 'original' && player.key !== this.focusedKey) {
          targets.set(player.key, 'preview');
        }
      }
      this.scheduleUpgradeCheck();
    }
    let changed = [...this.players.values()].filter((player) => {
      const wanted = player.wantedRendition();
      if (wanted === null) return false;
      const target = targets.get(player.key) ?? this.variant;
      // playing, a switch to the preview finishes before the camera may go back up (no flapping)
      if (this.playing && target === 'original' && wanted === 'preview' && player.isSwitching()) {
        return false;
      }
      return target !== wanted;
    });
    if (this.playing) {
      // While playing, one camera at a time loads the original: it gets the whole link (and the
      // browser's few connections per host), the others follow once it plays. The focused camera
      // goes first: other cameras' switches to the original give way to it.
      const focused = this.focusedKey ? this.players.get(this.focusedKey) : undefined;
      if (
        focused &&
        targets.get(focused.key) === 'original' &&
        focused.wantedRendition() !== 'original'
      ) {
        for (const player of this.players.values()) {
          if (player !== focused && player.isUpgrading()) {
            targets.set(player.key, player.getSnapshot().rendition ?? 'preview');
            if (!changed.includes(player)) changed.push(player);
          }
        }
      }
      const upgrading = [...this.players.values()].some(
        (player) =>
          player.isVisible() && player.isUpgrading() && targets.get(player.key) === 'original',
      );
      const upgrades = changed
        .filter((player) => targets.get(player.key) === 'original')
        .sort((a, b) => Number(b.key === this.focusedKey) - Number(a.key === this.focusedKey));
      const firstUpgrade =
        upgrading || !this.settledForUpgrade(upgrades.length > 0) ? [] : upgrades.slice(0, 1);
      changed = changed.filter(
        (player) => targets.get(player.key) !== 'original' || firstUpgrade.includes(player),
      );
    }
    if (changed.length === 0) return;
    if (this.resolvingEpisode) {
      // an episode switch resolves its files: it shows every camera; plan again after it
      this.replanAfterEpisode = true;
      return;
    }
    if (!this.playing) this.lastActivity = performance.now();
    const token = ++this.planToken;
    const group = this.playing ? null : new TransitionGroup();
    const resolved = changed.map((player) =>
      this.sourceFor(player.key, episodeIndex, targets.get(player.key) ?? this.variant),
    );
    const apply = (sources: Array<CameraSource | null>) => {
      if (token !== this.planToken || this.episodeIndex !== episodeIndex) return;
      this.resolvingPlan = false;
      const frame = this.getFrameIndex();
      changed.forEach((player, index) => {
        const source = sources[index];
        if (source) player.show(source, frame, group);
      });
      group?.seal();
    };
    if (resolved.some((source) => source instanceof Promise)) {
      if (!this.playing) this.resolvingPlan = true;
      void Promise.all(resolved).then(apply);
    } else {
      apply(resolved as Array<CameraSource | null>);
    }
  }

  private isStarved(featureKey: string): boolean {
    const entry = this.starved.get(featureKey);
    if (!entry) return false;
    if (performance.now() - entry.at > STARVED_FOR_MS) {
      this.starved.delete(featureKey);
      return false;
    }
    const visible = [...this.players.values()].filter((player) => player.isVisible()).length;
    return visible >= entry.visible;
  }

  private wantsOriginal(): boolean {
    return this.variant === 'original' && this.previewTemplate !== null;
  }

  /**
   * Whether the videos on screen stopped downloading ahead, so an original can start now (or the
   * wait for it timed out). Not yet: look again in a second.
   */
  private settledForUpgrade(wanted: boolean): boolean {
    if (!wanted) {
      this.upgradeWaitSince = null;
      return true;
    }
    const now = performance.now();
    this.upgradeWaitSince ??= now;
    if (!this.previewsDownloading()) {
      this.upgradeWaitSince = null;
      return true;
    }
    this.scheduleUpgradeCheck();
    return false;
  }

  /** A video on screen still downloads ahead (and has not been waited for too long). */
  private previewsDownloading(targets?: ReadonlyMap<string, Rendition>): boolean {
    const now = performance.now();
    if (this.upgradeWaitSince !== null && now - this.upgradeWaitSince > UPGRADE_SETTLE_MAX_MS) {
      return false;
    }
    this.upgradeWaitSince ??= now;
    // a preview loading, or filling its buffer at link speed (once it holds this much it only
    // tops up, at about its bit rate)
    const downloading = [...this.players.values()].some((player) => {
      if (!player.isVisible()) return false;
      if (player.isSwitching() && player.wantedRendition() === 'preview') return true;
      const active = player.active;
      // planned for the preview, not on it yet: its preview has still to load
      if (targets?.get(player.key) === 'preview' && player.getSnapshot().rendition !== 'preview') {
        return true;
      }
      if (player.getSnapshot().rendition !== 'preview' || active.getAttribute('src') === null) {
        return false;
      }
      const source = player.getSource();
      const end = source?.end ?? (Number.isFinite(active.duration) ? active.duration : Infinity);
      const filled = Math.min(PREVIEW_FILLED_SECONDS, end - active.currentTime - 0.5);
      return bufferedAhead(active, active.currentTime) < filled;
    });
    if (!downloading) this.upgradeWaitSince = null;
    return downloading;
  }

  private scheduleUpgradeCheck(): void {
    if (this.upgradeTimer !== null) return;
    this.upgradeTimer = window.setTimeout(() => {
      this.upgradeTimer = null;
      if (this.playing) this.replan();
    }, 1_000);
  }

  /** Bits per second of the original video of `featureKey` (size × 8 / duration), when known. */
  private originalBps(featureKey: string): number | null {
    return this.fileBps(featureKey, false);
  }

  private previewBps(featureKey: string): number | null {
    return this.previewTemplate ? this.fileBps(featureKey, true) : null;
  }

  private fileBps(featureKey: string, preview: boolean): number | null {
    if (this.episodeIndex === null || !this.loader) return null;
    const original = this.loader.getEpisodeVideoPath(this.episodeIndex, featureKey);
    if (!original) return null;
    const file = preview
      ? this.loader.getEpisodeVideoPath(this.episodeIndex, featureKey, this.previewTemplate!)
      : original;
    if (!file) return null;
    const size = this.sizes.get(file.path);
    if (typeof size !== 'number') return null;
    // The file's duration, once an element loaded it or its other rendition (the preview copy is
    // as long as the original). Never the episode's times: an episode far into a long recording
    // would make a 2 GB file look like it needs hundreds of Mbps.
    const player = this.players.get(featureKey);
    const previewFile = this.previewTemplate
      ? this.loader.getEpisodeVideoPath(this.episodeIndex, featureKey, this.previewTemplate)
      : null;
    const paths = [file.path, original.path, previewFile?.path].filter(
      (path): path is string => typeof path === 'string',
    );
    let duration: number | null = null;
    for (const path of paths) {
      const known = player?.mediaDuration(path) ?? this.durations.get(path) ?? null;
      if (known && known > 0) {
        duration = known;
        break;
      }
    }
    if (!duration) return null;
    for (const path of paths) this.durations.set(path, duration);
    return (size * 8) / duration;
  }

  /** Look up the sizes of the originals of the cameras and of the files on screen. */
  private loadSizes(episodeIndex: number): Promise<void> {
    const loader = this.loader;
    const getSize = loader?.dataSource.getSize?.bind(loader.dataSource);
    if (!loader || !getSize) return Promise.resolve();
    const lookups: Array<Promise<void>> = [];
    const paths = new Set<string>();
    for (const player of this.players.values()) {
      const original = loader.getEpisodeVideoPath(episodeIndex, player.key)?.path;
      if (original) paths.add(original);
      if (this.previewTemplate) {
        const preview = loader.getEpisodeVideoPath(episodeIndex, player.key, this.previewTemplate);
        if (preview) paths.add(preview.path);
      }
      // the files the elements load now (the preview), to count what they receive meanwhile
      for (const stream of player.streams()) paths.add(stream.path);
    }
    for (const path of paths) {
      const known = this.sizes.get(path);
      if (typeof known === 'number') continue;
      // a size the source could not tell is not asked again for a while (each ask can be a
      // request, or a manifest refresh, per path)
      const missedAt = this.sizeMisses.get(path);
      if (missedAt !== undefined && performance.now() - missedAt < SIZE_RETRY_MS) continue;
      if (known) {
        lookups.push(known);
        continue;
      }
      const lookup = getSize(path)
        .then((size) => {
          if (size > 0) {
            this.sizes.set(path, size);
            this.sizeMisses.delete(path);
          } else {
            this.sizes.delete(path);
            this.sizeMisses.set(path, performance.now());
          }
        })
        .catch(() => {
          this.sizes.delete(path);
          this.sizeMisses.set(path, performance.now());
        });
      this.sizes.set(path, lookup);
      lookups.push(lookup);
    }
    return Promise.all(lookups).then(() => undefined);
  }

  /**
   * Measure the link with a short download from the middle of an original (the file the cameras
   * would load), and plan again. Local files (no HTTP) are not limited.
   */
  private measure(): Promise<void> {
    if (this.measuring) return this.measuring;
    const loader = this.loader;
    const episodeIndex = this.episodeIndex;
    const key = this.focusedKey ?? [...this.players.values()].find((p) => p.isVisible())?.key;
    if (!loader || episodeIndex === null || !key) return Promise.resolve();
    const path = loader.getEpisodeVideoPath(episodeIndex, key)?.path;
    if (!path) return Promise.resolve();
    const run = async () => {
      // bounded: a size lookup that never answers must not hold every later measurement
      await Promise.race([
        this.loadSizes(episodeIndex),
        new Promise((resolve) => setTimeout(resolve, PROBE_TIMEOUT_MS)),
      ]);
      await this.quiet(loader);
      const url = await loader.getFileUrl(path);
      let bps: number | null;
      if (!/^https?:/i.test(url)) {
        bps = Number.POSITIVE_INFINITY;
      } else {
        const size = this.sizes.get(path);
        // the videos still downloading meanwhile share the link: add what they received
        const before = this.bufferedMedia();
        const startedAt = performance.now();
        bps = await this.measureLink(url, typeof size === 'number' ? Math.floor(size / 2) : 0);
        const elapsed = performance.now() - startedAt;
        const sharedBits = this.bufferedBits(before);
        if (bps !== null && elapsed > 0) bps += (sharedBits * 1000) / elapsed;
      }
      if (this.loader !== loader) return;
      if (bps !== null) {
        const now = performance.now();
        this.linkBps = this.linkEstimate.add(bps, now);
        this.linkMeasuredAt = now;
      }
    };
    this.measuring = run()
      .catch(() => undefined)
      .finally(() => {
        this.measuring = null;
        if (this.loader === loader && this.episodeIndex !== null) this.replan();
      });
    return this.measuring;
  }

  /** Media seconds each element has buffered (contiguously from its position), by element. */
  private bufferedMedia(): Map<HTMLVideoElement, { src: string; path: string; end: number }> {
    const marks = new Map<HTMLVideoElement, { src: string; path: string; end: number }>();
    for (const player of this.players.values()) {
      for (const { element, path } of player.streams()) {
        marks.set(element, {
          src: element.getAttribute('src') ?? '',
          path,
          end: element.currentTime + bufferedAhead(element, element.currentTime),
        });
      }
    }
    return marks;
  }

  /**
   * Bits the elements received since `before`: media seconds gained (net of playback: the end of
   * the buffer moves only by what arrived) times each file's bit rate.
   */
  private bufferedBits(
    before: Map<HTMLVideoElement, { src: string; path: string; end: number }>,
  ): number {
    let bits = 0;
    for (const [element, mark] of this.bufferedMedia()) {
      const previous = before.get(element);
      if (!previous || previous.src !== mark.src || mark.end <= previous.end) continue;
      const size = this.sizes.get(mark.path);
      const duration = element.duration;
      if (typeof size !== 'number' || !Number.isFinite(duration) || duration <= 0) continue;
      bits += (mark.end - previous.end) * ((size * 8) / duration);
    }
    return bits;
  }

  /**
   * Wait until no camera switches (its first frames would read as the link), at most
   * `LINK_QUIET_WAIT_MS`. Videos that keep buffering are counted by `bufferedBits`.
   */
  private async quiet(loader: LeRobotDataLoader): Promise<void> {
    const startedAt = performance.now();
    while (this.loader === loader && performance.now() - startedAt < LINK_QUIET_WAIT_MS) {
      if (![...this.players.values()].some((player) => player.isSwitching())) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /**
   * The playback stalled on an original: the link carries less than planned. Lower the estimate
   * below what the cameras on the original need, so the least important one goes back to the
   * preview (a measurement now would share the link with the stalled downloads and read low).
   */
  private onStall(repeated = false): void {
    this.stallTimer = null;
    if (!this.playing || !this.wantsOriginal()) return;
    if (!repeated && !this.mediaSync.isBuffering()) return;
    // a switch in flight shares the link on purpose; judge the link once the cameras settled
    if ([...this.players.values()].some((player) => player.isSwitching())) {
      this.heldSpans = [];
      return;
    }
    const onOriginal = [...this.players.values()].filter(
      (player) => player.isVisible() && player.getSnapshot().rendition === 'original',
    );
    // starved by the link: an original with (almost) nothing buffered. Stalls with buffered data
    // are the decoder or the page falling behind; a slower rendition would not help the link.
    const starved = onOriginal.some(
      (player) => bufferedAhead(player.active, player.active.currentTime) < STARVED_AHEAD_SECONDS,
    );
    if (!starved) return;
    if (this.linkBps === null) {
      void this.measure();
      return;
    }
    const now = performance.now();
    if (now - this.lastStallAt < LINK_STALL_BACKOFF_MS) return;
    this.lastStallAt = now;
    const needed = onOriginal.reduce((sum, player) => sum + (this.originalBps(player.key) ?? 0), 0);
    if (needed <= 0 || !Number.isFinite(this.linkBps)) return;
    this.linkBps = Math.min(this.linkBps, needed) * 0.85;
    // readings from before the stall above the cap are not this link any more: once the cap
    // lapses only fresh measurements may raise the estimate again
    this.linkEstimate.capAt(this.linkBps, now);
    this.linkMeasuredAt = now;
    this.replan();
  }

  /** The file and time range of `featureKey` for `episodeIndex` in `rendition`. */
  private sourceFor(
    featureKey: string,
    episodeIndex: number,
    rendition: Rendition,
  ): CameraSource | null | Promise<CameraSource | null> {
    const loader = this.loader;
    if (!loader) return null;
    const original = loader.getEpisodeVideoPath(episodeIndex, featureKey);
    if (!original) return null;
    const base: CameraSource = {
      path: original.path,
      start: original.fromSec ?? 0,
      end: original.toSec && original.toSec > (original.fromSec ?? 0) ? original.toSec : null,
      rendition: 'original',
      episode: episodeIndex,
    };
    if (rendition !== 'preview' || !this.previewTemplate) return base;
    const preview = loader.getEpisodeVideoPath(episodeIndex, featureKey, this.previewTemplate);
    if (!preview || preview.path === base.path) return base;
    const known = this.previewExists.get(preview.path);
    if (known === true) return { ...base, path: preview.path, rendition: 'preview' };
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
    return pending.then((exists) =>
      exists ? { ...base, path: preview.path, rendition: 'preview' as const } : base,
    );
  }

  private get resolving(): boolean {
    return this.resolvingEpisode || this.resolvingPlan;
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
      onVisibilityChange: () => {
        if (this.episodeIndex !== null) this.replan();
      },
      onSwitchStarved: (player) => {
        // The link did not carry this camera's original next to the others on screen: it keeps the
        // preview while as many cameras are visible (fewer, or a focus, may try again).
        const visible = [...this.players.values()].filter((other) => other.isVisible()).length;
        this.starved.set(player.key, { visible, at: performance.now() });
        if (this.playing) this.replan();
      },
      onPromoted: () => {
        // stalls before a switch tell nothing about the cameras after it
        this.heldSpans = [];
        // a camera finished its switch: the next one may start
        if (this.playing && this.episodeIndex !== null) this.replan();
      },
      get retryPolicy() {
        return retryPolicy();
      },
      probe: probeUrl,
    };
  }
}

function sameQuality(a: QualityStatus, b: QualityStatus): boolean {
  const round = (value: number | null) => (value === null ? null : Math.round(value));
  return (
    a.limited === b.limited &&
    round(a.neededMbps) === round(b.neededMbps) &&
    round(a.linkMbps) === round(b.linkMbps) &&
    a.originalCount === b.originalCount &&
    a.visibleCount === b.visibleCount &&
    a.focusedOriginal === b.focusedOriginal
  );
}
