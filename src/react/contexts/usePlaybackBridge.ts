import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { EpisodeMetadata, PlaybackMode, EpisodeTrimRange } from '@/core';
import { PlaybackEngine } from '../services/PlaybackEngine';
import { PlaybackClock, timeOfFrame } from '../services/PlaybackClock';

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
}: UsePlaybackBridgeOptions) {
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const pendingIntentRef = useRef(new PendingPlaybackIntent());
  /** The one time owner for this viewer; cameras follow it, charts derive frames from it. */
  const [clock] = useState(() => new PlaybackClock());

  // The engine lives as long as the provider and reads the latest values
  // through this ref, so changing speed or episode never restarts playback.
  const latest = useRef({
    previewRange,
    frameCount,
    fps,
    playbackSpeed,
    playbackMode,
    episodes,
    selectedEpisodeIndex,
    deletedEpisodes,
  });
  latest.current = {
    previewRange,
    frameCount,
    fps,
    playbackSpeed,
    playbackMode,
    episodes,
    selectedEpisodeIndex,
    deletedEpisodes,
  };

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
      clock.seek(timeOfFrame(index, fps || 30));
      if (!isPlaying) setCurrentFrameIndex(index);
      notifyFrameSubscribers(index);
    },
    [clock, fps, frameCount, frameIndexRef, isPlaying, notifyFrameSubscribers],
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

  const [engine] = useState(
    () =>
      new PlaybackEngine(
        {
          getFrameIndex: () => frameIndexRef.current,
          setFrameIndexSilent: (index) => {
            frameIndexRef.current = index;
          },
          notifyFrame: (index) => notifyRef.current(index),
          getFrameCount: () => latest.current.frameCount,
          getPreviewRange: () => latest.current.previewRange,
          getFps: () => latest.current.fps || 30,
          getPlaybackSpeed: () => latest.current.playbackSpeed,
          getPlaybackMode: () => latest.current.playbackMode,
          getEpisodes: () => latest.current.episodes,
          getSelectedEpisodeIndex: () => latest.current.selectedEpisodeIndex,
          getDeletedEpisodes: () => latest.current.deletedEpisodes,
          onStop: () => setIsPlaying(false),
          shouldHoldAtEpisodeEnd: () => shouldHoldRef.current?.current() ?? false,
          onNaturalEnd: () => onNaturalEndHolder.current?.current(),
          onAdvanceEpisode: (episodeIndex) => selectEpisodeRef.current(episodeIndex),
          onResumeAfterEpisode: () => setIsPlaying(true),
        },
        clock,
      ),
  );
  const notifyRef = useRef(notifyFrameSubscribers);
  notifyRef.current = notifyFrameSubscribers;
  const shouldHoldRef = useRef(shouldHoldAtEpisodeEndRef);
  shouldHoldRef.current = shouldHoldAtEpisodeEndRef;
  const onNaturalEndHolder = useRef(onNaturalEndRef);
  onNaturalEndHolder.current = onNaturalEndRef;

  useEffect(() => () => engine.dispose(), [engine]);

  // A new episode starts at frame 0 of the clock.
  useEffect(() => {
    clock.seek(timeOfFrame(frameIndexRef.current, latest.current.fps || 30));
  }, [clock, frameIndexRef, selectedEpisodeIndex]);

  useEffect(() => {
    if (isPlaying && frameCount > 0 && !isBusy) {
      engine.start();
    } else {
      engine.stop();
      if (!isPlaying && frameIndexRef.current !== currentFrameIndex) {
        setCurrentFrameIndex(frameIndexRef.current);
      }
    }
  }, [engine, isPlaying, frameCount, isBusy, currentFrameIndex, frameIndexRef]);

  return {
    clock,
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
