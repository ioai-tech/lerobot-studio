import { useEffect, useCallback, useRef } from 'react';
import {
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSegments,
  useLeRobotSelection,
  useLeRobotSubtask,
  useLeRobotUi,
} from '../contexts/LeRobotContext';
import { usePortalContainer } from '@/ui';
import { fieldOptionForKey } from '@/core';
import { isDetachedFocusTarget, isPlaybackShortcutBlocked } from './shortcutTarget';
import { usePageKeys, type LeRobotKeyboardScope } from './pageKeys';
import {
  isSegmentShortcutTarget,
  matchFieldOptionKey,
  matchSegmentShortcut,
  SEGMENT_SHORTCUTS,
  type SegmentShortcutId,
} from './segmentShortcuts';

/** Video-player and segment keyboard shortcuts. */
/** J / K without modifiers, as the episode step they stand for (↓ / ↑). */
export function episodeStepKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): 'ArrowDown' | 'ArrowUp' | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'j') return 'ArrowDown';
  if (event.key === 'k') return 'ArrowUp';
  return null;
}

export const useKeyboardShortcuts = (
  enabled: boolean = true,
  scope: LeRobotKeyboardScope = 'auto',
) => {
  const portalContainer = usePortalContainer();
  const ownsPageKeys = usePageKeys(portalContainer, scope, enabled);
  const { episodes, getFrameIndex, isLoading, info } = useLeRobotData();
  const { selectedEpisodeIndex, selectEpisode } = useLeRobotSelection();
  const { setFrameIndex, setPlaying, currentFrames, isPlaying } = useLeRobotPlayback();
  const { canAnnotate, endAtPlayhead, pendingRange, clearPendingAnnotation, beginPendingRange } =
    useLeRobotSubtask();
  const { setSubtaskDialogOpen, subtaskDialogOpen, trimSuggestion } = useLeRobotUi();
  const segments = useLeRobotSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const fpsRef = useRef(info?.fps ?? 30);
  fpsRef.current = info?.fps ?? 30;
  const beginPendingRangeRef = useRef(beginPendingRange);
  beginPendingRangeRef.current = beginPendingRange;

  const enabledRef = useRef(enabled);
  const episodesRef = useRef(episodes);
  const selectedEpisodeIndexRef = useRef(selectedEpisodeIndex);
  const currentFramesRef = useRef(currentFrames);
  const isLoadingRef = useRef(isLoading);
  const canAnnotateRef = useRef(canAnnotate);
  // Pause-to-label is the standalone flow; a host-controlled viewer labels with Shift+[ / Shift+].
  const pauseToLabelRef = useRef(!segments.controlled && !trimSuggestion);
  const endAtPlayheadRef = useRef(endAtPlayhead);
  const pendingRangeRef = useRef(pendingRange);
  const clearPendingAnnotationRef = useRef(clearPendingAnnotation);
  const setSubtaskDialogOpenRef = useRef(setSubtaskDialogOpen);
  const setPlayingRef = useRef(setPlaying);
  const isPlayingRef = useRef(isPlaying);
  const subtaskDialogOpenRef = useRef(subtaskDialogOpen);
  const trimSuggestionRef = useRef(trimSuggestion);

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
    pauseToLabelRef.current = !segments.controlled && !trimSuggestion;
  }, [segments.controlled, trimSuggestion]);

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

  useEffect(() => {
    trimSuggestionRef.current = trimSuggestion;
  }, [trimSuggestion]);

  const runSegmentShortcut = useCallback(
    (id: SegmentShortcutId): boolean => {
      const api = segmentsRef.current;
      const shortcut = SEGMENT_SHORTCUTS.find((item) => item.id === id);
      if (!shortcut || (shortcut.edit && !api.canEdit)) return false;
      const frame = getFrameIndex();
      const nudge = (direction: 1 | -1, seconds: boolean) => {
        api.nudgeEdgeNearPlayhead(
          direction * (seconds ? Math.max(1, Math.round(fpsRef.current)) : 1),
        );
        return true;
      };
      switch (id) {
        case 'confirm':
          api.confirmSelected();
          return true;
        case 'confirmAll':
          if (api.toReviewInView.length === 0) api.showNotice('segments.notice.noneToReview');
          else api.setConfirmAllOpen(true);
          return true;
        case 'delete':
          api.deleteSelected();
          return true;
        case 'split':
          api.splitAtPlayhead();
          return true;
        case 'merge':
          api.mergeWithNext();
          return true;
        case 'setIn':
          api.setEdgeAtPlayhead('start');
          return true;
        case 'setOut':
          api.setEdgeAtPlayhead('end');
          return true;
        case 'nudgeBack':
          return nudge(-1, false);
        case 'nudgeForward':
          return nudge(1, false);
        case 'nudgeBackSecond':
          return nudge(-1, true);
        case 'nudgeForwardSecond':
          return nudge(1, true);
        case 'new':
          api.createAtPlayhead();
          return true;
        case 'nextUncovered':
          api.jumpToNextUncovered();
          return true;
        case 'next':
          api.selectRelative(1);
          return true;
        case 'previous':
          api.selectRelative(-1);
          return true;
        case 'loop':
          api.toggleLoop();
          return true;
        case 'subtaskStart':
          if (!api.canEditSubtasks) return false;
          api.setSubtaskStart(frame);
          api.showNotice('segments.notice.subtaskStartSet');
          return true;
        case 'subtaskEnd': {
          if (!api.canEditSubtasks) return false;
          const start = api.subtaskStart;
          if (start == null) {
            api.showNotice('segments.notice.subtaskStartFirst', undefined, 'error');
            return true;
          }
          setPlayingRef.current(false);
          if (beginPendingRangeRef.current(start, frame)) {
            api.setSubtaskStart(null);
            setSubtaskDialogOpenRef.current(true);
          } else {
            api.showNotice('segments.notice.subtaskInvalid', undefined, 'error');
          }
          return true;
        }
        case 'undo':
          api.undo();
          return true;
        case 'redo':
          api.redo();
          return true;
        case 'help':
          api.setShortcutSheetOpen(true);
          return true;
      }
    },
    [getFrameIndex],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabledRef.current || isLoadingRef.current) return;
      if (e.defaultPrevented) return;

      const target = e.target;
      const inside =
        !portalContainer || (target instanceof Node && portalContainer.contains(target));
      // A key pressed on the page itself (focus on <body>: the viewer just opened,
      // the host navigated, a click landed where nothing takes focus) belongs to
      // one viewer only: the one shown that opened or was used last (F-01).
      const onPage = !inside && isDetachedFocusTarget(target) && ownsPageKeys();
      if (!inside && !onPage) return;
      // Segment keys exist only while the segment UI does (a plain viewer is unchanged).
      if (
        segmentsRef.current.active &&
        (onPage || isSegmentShortcutTarget(target, portalContainer))
      ) {
        const id = matchSegmentShortcut(e);
        if (id) {
          if (runSegmentShortcut(id)) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        const optionKey = matchFieldOptionKey(e);
        const api = segmentsRef.current;
        if (optionKey && api.canEdit) {
          const match = fieldOptionForKey(api.fields, optionKey);
          if (match) {
            e.preventDefault();
            e.stopPropagation();
            api.setFieldValue(match.field.id, match.value);
            return;
          }
        }
      }

      if (isPlaybackShortcutBlocked(target, e.key)) return;

      // One key map (s10 F-12): J / K step to the next / previous item. With the
      // segment UI on they are segment keys only (above), never an episode step,
      // wherever focus is; with it off they step episodes, as ↓ / ↑ do.
      const key = (segmentsRef.current.active ? null : episodeStepKey(e)) ?? e.key;
      const preventDefaultKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
      if (preventDefaultKeys.includes(key)) {
        e.preventDefault();
        e.stopPropagation();
      }

      const currentEpisodes = episodesRef.current;
      const currentSelectedIndex = selectedEpisodeIndexRef.current;
      const currentFrames = currentFramesRef.current;
      const currentFrameIndex = getFrameIndex();
      const totalFrames = currentFrames.length;
      const canUseSubtaskKeys =
        canAnnotateRef.current && pauseToLabelRef.current && totalFrames > 0;

      switch (key) {
        case 'ArrowUp': {
          if (trimSuggestionRef.current) return;
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
          if (trimSuggestionRef.current) return;
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
          if (segmentsRef.current.subtaskStart != null) {
            segmentsRef.current.setSubtaskStart(null);
          }
          if (pendingRangeRef.current != null && !subtaskDialogOpenRef.current) {
            e.preventDefault();
            clearPendingAnnotationRef.current();
          }
          break;
        }
      }
    },
    [
      selectEpisode,
      setFrameIndex,
      getFrameIndex,
      portalContainer,
      ownsPageKeys,
      runSegmentShortcut,
    ],
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
};
