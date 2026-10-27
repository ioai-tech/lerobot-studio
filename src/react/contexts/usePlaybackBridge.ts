import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { EpisodeMetadata, PlaybackMode, EpisodeTrimRange } from '@/core';
import { PlaybackEngine } from '../services/PlaybackEngine';
import type { MediaSync } from '../services/MediaSync';

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

  const setFrameIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= frameCount) return;
      frameIndexRef.current = index;
      if (!isPlaying) setCurrentFrameIndex(index);
      notifyFrameSubscribers(index);
    },
    [frameCount, frameIndexRef, isPlaying, notifyFrameSubscribers],
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
            onPlaybackStop: () => mediaSync.stop(),
          }
        : {}),
    });
    playbackEngineRef.current = engine;
    return () => {
      engine.dispose();
      playbackEngineRef.current = null;
    };
  }, [frameIndexRef, selectEpisodeRef, shouldHoldAtEpisodeEndRef, onNaturalEndRef, mediaSync]);

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
  };
}
