import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { EpisodeMetadata, PlaybackMode } from '@/core';
import { PlaybackEngine } from '../services/PlaybackEngine';

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
};

export function usePlaybackBridge({
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
}: UsePlaybackBridgeOptions) {
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

  const playbackEngineRef = useRef<PlaybackEngine | null>(null);
  useEffect(() => {
    const engine = new PlaybackEngine({
      getFrameIndex: () => frameIndexRef.current,
      setFrameIndexSilent: (index) => {
        frameIndexRef.current = index;
      },
      notifyFrame: notifyFrameSubscribers,
      getFrameCount: () => frameCount,
      getFps: () => fps || 30,
      getPlaybackSpeed: () => playbackSpeed,
      getPlaybackMode: () => playbackMode,
      getEpisodes: () => episodes,
      getSelectedEpisodeIndex: () => selectedEpisodeIndex,
      getDeletedEpisodes: () => deletedEpisodes,
      onStop: () => setIsPlaying(false),
      shouldHoldAtEpisodeEnd: () => shouldHoldAtEpisodeEndRef?.current() ?? false,
      onNaturalEnd: () => onNaturalEndRef?.current(),
      onAdvanceEpisode: (episodeIndex) => selectEpisodeRef.current(episodeIndex),
      onResumeAfterEpisode: () => setIsPlaying(true),
    });
    playbackEngineRef.current = engine;
    return () => {
      engine.dispose();
      playbackEngineRef.current = null;
    };
  }, [
    frameCount,
    frameIndexRef,
    fps,
    playbackSpeed,
    playbackMode,
    episodes,
    selectedEpisodeIndex,
    deletedEpisodes,
    selectEpisodeRef,
    notifyFrameSubscribers,
    shouldHoldAtEpisodeEndRef,
    onNaturalEndRef,
  ]);

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
