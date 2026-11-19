import { useEffect, useRef, type MutableRefObject } from 'react';
import type { PendingSelection } from '@/core';
import {
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSegments,
  useLeRobotSelection,
} from '../../contexts/LeRobotContext';
import type { LeRobotSelection } from '../../contexts/hostTypes';

/** The selection carried across a data-source swap. */
export type SelectionCarry = PendingSelection;

/** Time reports at most four times a second. */
const TIME_REPORT_INTERVAL_MS = 250;

function sameSelection(a: LeRobotSelection | null, b: LeRobotSelection): boolean {
  return (
    a !== null &&
    a.episodeIndex === b.episodeIndex &&
    a.segmentId === b.segmentId &&
    a.timeS === b.timeS
  );
}

/**
 * Reports the selection to the host (`onSelectionChange`) and captures it for
 * a data-source swap. Renders nothing; it lives in its own component so
 * playback state changes never re-render the viewer layout.
 */
export function SelectionBridge({
  captureRef,
  onSelectionChange,
}: {
  captureRef: MutableRefObject<() => SelectionCarry | null>;
  onSelectionChange?: (selection: LeRobotSelection) => void;
}) {
  const {
    info,
    episodes,
    getFrameIndex,
    subscribeFrameIndex,
    hasPendingSelection,
    subscribeSelectionSettled,
  } = useLeRobotData();
  const { selectedEpisodeIndex } = useLeRobotSelection();
  const { isPlaying } = useLeRobotPlayback();
  const { selectedSegmentId } = useLeRobotSegments();
  const fps = info?.fps || 30;

  captureRef.current = () => {
    if (selectedEpisodeIndex == null) return null;
    const episode = episodes.find((item) => item.episode_index === selectedEpisodeIndex);
    if (!episode) return null;
    return {
      episodeIndex: selectedEpisodeIndex,
      segmentId: selectedSegmentId ?? undefined,
      frame: getFrameIndex(),
      requireLength: episode.length,
      resume: isPlaying,
    };
  };

  const onChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onSelectionChange;
  const lastRef = useRef<LeRobotSelection | null>(null);
  const lastAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  /** A report was held back while a selection was on its way. */
  const heldBackRef = useRef(false);
  const reportRef = useRef<(immediate: boolean) => void>(() => undefined);

  reportRef.current = (immediate: boolean) => {
    const callback = onChangeRef.current;
    // Nothing to report before an episode is open, or while a selection is on
    // its way (held back, and made once it settled).
    if (!callback || selectedEpisodeIndex == null) return;
    if (hasPendingSelection()) {
      heldBackRef.current = true;
      return;
    }
    heldBackRef.current = false;
    const next: LeRobotSelection = {
      episodeIndex: selectedEpisodeIndex,
      segmentId: selectedSegmentId,
      timeS: getFrameIndex() / fps,
    };
    if (sameSelection(lastRef.current, next)) return;
    const now = performance.now();
    const wait = lastAtRef.current + TIME_REPORT_INTERVAL_MS - now;
    if (!immediate && wait > 0) {
      // Trailing report, so the last time of a burst is never lost.
      if (timerRef.current == null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          reportRef.current(false);
        }, wait);
      }
      return;
    }
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastAtRef.current = now;
    lastRef.current = next;
    callback(next);
  };

  // Episode and segment changes are reported at once.
  useEffect(() => {
    reportRef.current(true);
  }, [selectedEpisodeIndex, selectedSegmentId]);

  useEffect(() => subscribeFrameIndex(() => reportRef.current(false)), [subscribeFrameIndex]);

  // A report held back while a selection was pending is made once it settled,
  // also when no frame change follows (a swap that lands where it was).
  useEffect(
    () =>
      subscribeSelectionSettled(() => {
        if (heldBackRef.current) reportRef.current(false);
      }),
    [subscribeSelectionSettled],
  );

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return null;
}
