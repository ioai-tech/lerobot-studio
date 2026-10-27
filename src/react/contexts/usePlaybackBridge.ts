import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { EpisodeMetadata, PlaybackMode, EpisodeTrimRange } from '@/core';
import { PlaybackEngine } from '../services/PlaybackEngine';
import type { MediaSync } from '../services/MediaSync';
import type { VideoStage } from '../services/video/VideoStage';

export class PendingPlaybackIntent {
  private target: boolean | null = null;
  private toggleOnce = false;

  requestSet(target: boolean): void {
    this.target = target;
  }

  requestToggle(): void {
    this.toggleOnce = !this.toggleOnce;
  }

  flush(onSet: (target: boolean) => void, onToggle: () => void): void {
    if (this.target !== null) {
      const target = this.target;
      this.target = null;
      this.toggleOnce = false;
      onSet(target);
    } else if (this.toggleOnce) {
      this.toggleOnce = false;
      onToggle();
    }
  }
}

type UsePlaybackBridgeOptions = {
  previewRange?: EpisodeTrimRange;
  isBusy: boolean;
  frameCount: number;
  frameIndexRef: MutableRefObject<number>;
  notifyFrameSubscribers: (index: number) => void;
  fps: number | null | undefined;
  playbackSpeed: number;
  playbackMode: PlaybackMode;
  episodes: EpisodeMetadata[];
  selectedEpisodeIndex: number | null;
  deletedEpisodes: Set<number>;
  selectEpisodeRef: MutableRefObject<(episodeIndex: number) => Promise<boolean>>;
  shouldHoldAtEpisodeEndRef?: MutableRefObject<() => boolean>;
  onNaturalEndRef?: MutableRefObject<() => void>;
  /** Native video clock; without it the engine's timer drives every panel. */
  mediaSync?: MediaSync;
  /** The cameras: a loop restarts through their prefetched standby elements. */
  videoStage?: VideoStage;
};

export function usePlaybackBridge({
  previewRange,
  isBusy,
  frameCount,
  frameIndexRef,
  notifyFrameSubscribers,
  fps,
  playbackSpeed,
  playbackMode,
  episodes,
  selectedEpisodeIndex,
  deletedEpisodes,
  selectEpisodeRef,
  shouldHoldAtEpisodeEndRef,
  onNaturalEndRef,
  mediaSync,
  videoStage,
}: UsePlaybackBridgeOptions) {
  const previewRangeRef = useRef(previewRange);
  previewRangeRef.current = previewRange;
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const pendingIntentRef = useRef(new PendingPlaybackIntent());

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) setIsPlaying(false);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Scrubbing notifies the frame subscribers (videos, chart cursor) at once, but re-renders React at
  // most once per animation frame.
  const pendingRenderRef = useRef<{ index: number; handle: number | null }>({
    index: 0,
    handle: null,
  });
  const renderFrameIndex = useCallback((index: number) => {
    const pending = pendingRenderRef.current;
    pending.index = index;
    if (typeof requestAnimationFrame !== 'function') {
      setCurrentFrameIndex(index);
      return;
    }
    if (pending.handle !== null) return;
    pending.handle = requestAnimationFrame(() => {
      pending.handle = null;
      setCurrentFrameIndex(pending.index);
    });
  }, []);
  useEffect(
    () => () => {
      const pending = pendingRenderRef.current;
      if (pending.handle !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(pending.handle);
      }
      pending.handle = null;
    },
    [],
  );

  const setFrameIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= frameCount) return;
      frameIndexRef.current = index;
      if (isPlaying) {
        // playing: move every camera (master and followers); the clock continues from there
        mediaSync?.seekFrame(index);
      } else {
        renderFrameIndex(index);
      }
      notifyFrameSubscribers(index);
    },
    [frameCount, frameIndexRef, isPlaying, mediaSync, notifyFrameSubscribers, renderFrameIndex],
  );

  const togglePlay = useCallback(() => {
    if (isBusy) {
      pendingIntentRef.current.requestToggle();
      return;
    }
    setIsPlaying((previous) => !previous);
  }, [isBusy]);

  const setPlaying = useCallback(
    (target: boolean) => {
      if (isBusy) {
        pendingIntentRef.current.requestSet(target);
        return;
      }
      setIsPlaying(target);
    },
    [isBusy],
  );

  useEffect(() => {
    if (isBusy) return;
    pendingIntentRef.current.flush(setIsPlaying, () => setIsPlaying((previous) => !previous));
  }, [isBusy]);

  const seek = useCallback(
    (offset: number) => {
      if (!isBusy) setFrameIndex(frameIndexRef.current + offset);
    },
    [frameIndexRef, isBusy, setFrameIndex],
  );

  // The engine lives as long as the provider and reads current values through this ref. Recreating
  // it on every dependency change disposed a running engine (stopping playback and pausing the
  // videos) without starting its replacement.
  const latestRef = useRef({
    frameCount,
    fps,
    playbackSpeed,
    playbackMode,
    episodes,
    selectedEpisodeIndex,
    deletedEpisodes,
    notifyFrameSubscribers,
  });
  latestRef.current = {
    frameCount,
    fps,
    playbackSpeed,
    playbackMode,
    episodes,
    selectedEpisodeIndex,
    deletedEpisodes,
    notifyFrameSubscribers,
  };

  const playbackEngineRef = useRef<PlaybackEngine | null>(null);
  useEffect(() => {
    const latest = () => latestRef.current;
    const engine = new PlaybackEngine({
      getFrameIndex: () => frameIndexRef.current,
      setFrameIndexSilent: (index) => {
        frameIndexRef.current = index;
      },
      notifyFrame: (index) => latest().notifyFrameSubscribers(index),
      getFrameCount: () => latest().frameCount,
      getPreviewRange: () => previewRangeRef.current,
      getFps: () => latest().fps || 30,
      getPlaybackSpeed: () => latest().playbackSpeed,
      getPlaybackMode: () => latest().playbackMode,
      getEpisodes: () => latest().episodes,
      getSelectedEpisodeIndex: () => latest().selectedEpisodeIndex,
      getDeletedEpisodes: () => latest().deletedEpisodes,
      onStop: () => setIsPlaying(false),
      shouldHoldAtEpisodeEnd: () => shouldHoldAtEpisodeEndRef?.current() ?? false,
      onNaturalEnd: () => onNaturalEndRef?.current(),
      onAdvanceEpisode: (episodeIndex) => selectEpisodeRef.current(episodeIndex),
      onResumeAfterEpisode: () => setIsPlaying(true),
      ...(mediaSync
        ? {
            getMediaClock: () => mediaSync.tick(),
            onPlaybackStart: (frameIndex: number, rate: number) => {
              mediaSync.setFps(latest().fps);
              mediaSync.start(frameIndex, rate);
            },
            onPlaybackStop: () => {
              mediaSync.stop();
              videoStage?.alignToPlayhead();
            },
            ...(videoStage
              ? {
                  onLoopRestart: (rate: number) => {
                    mediaSync.stop();
                    videoStage.restartEpisode();
                    mediaSync.setFps(latest().fps);
                    mediaSync.start(0, rate);
                  },
                }
              : {}),
          }
        : {}),
    });
    playbackEngineRef.current = engine;
    return () => {
      engine.dispose();
      playbackEngineRef.current = null;
    };
  }, [
    frameIndexRef,
    selectEpisodeRef,
    shouldHoldAtEpisodeEndRef,
    onNaturalEndRef,
    mediaSync,
    videoStage,
  ]);

  /** The episode playback continues with after the selected one (loop: itself; -1: none). */
  const peekNextEpisode = useCallback((): number => {
    if (latestRef.current.playbackMode === 'loop')
      return latestRef.current.selectedEpisodeIndex ?? -1;
    return playbackEngineRef.current?.peekNextEpisode() ?? -1;
  }, []);

  // speed changes apply to the running videos without restarting playback
  useEffect(() => {
    mediaSync?.setRate(playbackSpeed);
  }, [mediaSync, playbackSpeed]);

  useEffect(() => {
    const engine = playbackEngineRef.current;
    if (!engine) return;
    if (isPlaying && frameCount > 0 && !isBusy) {
      engine.start();
    } else {
      engine.stop();
      if (!isPlaying && frameIndexRef.current !== currentFrameIndex) {
        setCurrentFrameIndex(frameIndexRef.current);
      }
    }
    return () => engine.stop();
  }, [isPlaying, frameCount, isBusy, currentFrameIndex, frameIndexRef]);

  return {
    currentFrameIndex,
    setCurrentFrameIndex,
    isPlaying,
    setIsPlaying,
    setFrameIndex,
    togglePlay,
    setPlaying,
    seek,
    peekNextEpisode,
  };
}
