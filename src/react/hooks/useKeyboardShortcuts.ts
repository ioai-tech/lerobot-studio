import { useEffect, useCallback, useRef } from 'react';
import {
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSelection,
  useLeRobotSubtask,
  useLeRobotUi,
} from '../contexts/LeRobotContext';
import { usePortalContainer } from '@/ui';
import { isEventInsideStudio, isPlaybackShortcutBlocked } from './shortcutTarget';

/** Video-player keyboard shortcuts. */
export const useKeyboardShortcuts = (enabled: boolean = true) => {
  const portalContainer = usePortalContainer();
  const { episodes, getFrameIndex, isLoading } = useLeRobotData();
  const { selectedEpisodeIndex, selectEpisode } = useLeRobotSelection();
  const { setFrameIndex, setPlaying, currentFrames, isPlaying } = useLeRobotPlayback();
  const { canAnnotate, endAtPlayhead, pendingRange, clearPendingAnnotation } = useLeRobotSubtask();
  const { setSubtaskDialogOpen, episodeEditMode, subtaskDialogOpen } = useLeRobotUi();

  const enabledRef = useRef(enabled);
  const episodesRef = useRef(episodes);
  const selectedEpisodeIndexRef = useRef(selectedEpisodeIndex);
  const currentFramesRef = useRef(currentFrames);
  const isLoadingRef = useRef(isLoading);
  const canAnnotateRef = useRef(canAnnotate);
  const episodeEditModeRef = useRef(episodeEditMode);
  const endAtPlayheadRef = useRef(endAtPlayhead);
  const pendingRangeRef = useRef(pendingRange);
  const clearPendingAnnotationRef = useRef(clearPendingAnnotation);
  const setSubtaskDialogOpenRef = useRef(setSubtaskDialogOpen);
  const setPlayingRef = useRef(setPlaying);
  const isPlayingRef = useRef(isPlaying);
  const subtaskDialogOpenRef = useRef(subtaskDialogOpen);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    episodesRef.current = episodes;
  }, [episodes]);

  useEffect(() => {
    selectedEpisodeIndexRef.current = selectedEpisodeIndex;
  }, [selectedEpisodeIndex]);

  useEffect(() => {
    currentFramesRef.current = currentFrames;
  }, [currentFrames]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    canAnnotateRef.current = canAnnotate;
  }, [canAnnotate]);

  useEffect(() => {
    episodeEditModeRef.current = episodeEditMode;
  }, [episodeEditMode]);

  useEffect(() => {
    endAtPlayheadRef.current = endAtPlayhead;
  }, [endAtPlayhead]);

  useEffect(() => {
    pendingRangeRef.current = pendingRange;
  }, [pendingRange]);

  useEffect(() => {
    clearPendingAnnotationRef.current = clearPendingAnnotation;
  }, [clearPendingAnnotation]);

  useEffect(() => {
    setSubtaskDialogOpenRef.current = setSubtaskDialogOpen;
  }, [setSubtaskDialogOpen]);

  useEffect(() => {
    setPlayingRef.current = setPlaying;
  }, [setPlaying]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    subtaskDialogOpenRef.current = subtaskDialogOpen;
  }, [subtaskDialogOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabledRef.current || isLoadingRef.current) return;
      if (e.defaultPrevented) return;

      const target = e.target;
      if (!isEventInsideStudio(target, portalContainer)) return;
      if (isPlaybackShortcutBlocked(target)) return;

      const preventDefaultKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
      if (preventDefaultKeys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }

      const currentEpisodes = episodesRef.current;
      const currentSelectedIndex = selectedEpisodeIndexRef.current;
      const currentFrames = currentFramesRef.current;
      const currentFrameIndex = getFrameIndex();
      const totalFrames = currentFrames.length;
      const canUseSubtaskKeys =
        canAnnotateRef.current && episodeEditModeRef.current && totalFrames > 0;

      switch (e.key) {
        case 'ArrowUp': {
          if (currentEpisodes.length === 0) return;

          const currentEpisode = currentEpisodes.find(
            (ep) => ep.episode_index === currentSelectedIndex,
          );

          if (!currentEpisode) {
            if (currentEpisodes.length > 0) {
              selectEpisode(currentEpisodes[0].episode_index);
            }
            return;
          }

          const currentIndex = currentEpisodes.findIndex(
            (ep) => ep.episode_index === currentEpisode.episode_index,
          );

          if (currentIndex > 0) {
            const prevEpisode = currentEpisodes[currentIndex - 1];
            selectEpisode(prevEpisode.episode_index);
          }
          break;
        }

        case 'ArrowDown': {
          if (currentEpisodes.length === 0) return;

          const currentEpisode = currentEpisodes.find(
            (ep) => ep.episode_index === currentSelectedIndex,
          );

          if (!currentEpisode) {
            if (currentEpisodes.length > 0) {
              selectEpisode(currentEpisodes[0].episode_index);
            }
            return;
          }

          const currentIndex = currentEpisodes.findIndex(
            (ep) => ep.episode_index === currentEpisode.episode_index,
          );

          if (currentIndex < currentEpisodes.length - 1) {
            const nextEpisode = currentEpisodes[currentIndex + 1];
            selectEpisode(nextEpisode.episode_index);
          }
          break;
        }

        case 'ArrowLeft': {
          if (totalFrames === 0) return;

          let step = 1;
          if (e.shiftKey) {
            step = 10;
          } else if (e.ctrlKey || e.metaKey) {
            step = 5;
          }

          const newIndex = Math.max(0, currentFrameIndex - step);
          setFrameIndex(newIndex);
          break;
        }

        case 'ArrowRight': {
          if (totalFrames === 0) return;

          let step = 1;
          if (e.shiftKey) {
            step = 10;
          } else if (e.ctrlKey || e.metaKey) {
            step = 5;
          }

          const newIndex = Math.min(totalFrames - 1, currentFrameIndex + step);
          setFrameIndex(newIndex);
          break;
        }

        case ' ': {
          e.preventDefault();
          if (totalFrames === 0 || subtaskDialogOpenRef.current) return;
          if (isPlayingRef.current) {
            setPlayingRef.current(false);
            if (canUseSubtaskKeys && endAtPlayheadRef.current(currentFrameIndex)) {
              setSubtaskDialogOpenRef.current(true);
            }
          } else {
            setPlayingRef.current(true);
          }
          break;
        }

        case 'Home': {
          if (totalFrames > 0) {
            setFrameIndex(0);
          }
          break;
        }

        case 'End': {
          if (totalFrames > 0) {
            setFrameIndex(totalFrames - 1);
          }
          break;
        }

        case 'Escape': {
          if (pendingRangeRef.current != null && !subtaskDialogOpenRef.current) {
            e.preventDefault();
            clearPendingAnnotationRef.current();
          }
          break;
        }
      }
    },
    [selectEpisode, setFrameIndex, getFrameIndex, portalContainer],
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
};
