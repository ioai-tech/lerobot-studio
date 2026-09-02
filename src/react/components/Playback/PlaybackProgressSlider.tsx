import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FrameData, SubtaskSegment } from '@/core';
import type { PendingSubtaskRange } from '../../contexts/useSubtaskAnnotation';
import { SubtaskRangeTrack } from './SubtaskRangeTrack';

const THUMB_SIZE_PX = 16;
const A11Y_SYNC_INTERVAL_MS = 250;

function getThumbLeft(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  return `calc(${(clamped * 100).toFixed(4)}% - ${THUMB_SIZE_PX / 2}px)`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export interface PlaybackProgressSliderProps {
  currentFrames: FrameData[];
  fps: number;
  totalFrames: number;
  totalTime: number;
  initialFrameIndex: number;
  isDisabled: boolean;
  setFrameIndex: (index: number) => void;
  getFrameIndex: () => number;
  subscribeFrameIndex: (callback: (frameIndex: number) => void) => () => void;
  segments?: SubtaskSegment[];
  pendingRange?: PendingSubtaskRange | null;
  editRanges?: boolean;
  knownLabels?: string[];
  onReplaceSegments?: (segments: SubtaskSegment[]) => void;
  onFillGap?: (startFrame: number, endFrame: number) => void;
  onDeleteSegment?: (index: number) => void;
  onRenameSegment?: (index: number) => void;
}

const PlaybackProgressSliderComponent: React.FC<PlaybackProgressSliderProps> = ({
  currentFrames,
  fps,
  totalFrames,
  totalTime,
  initialFrameIndex,
  isDisabled,
  setFrameIndex,
  getFrameIndex,
  subscribeFrameIndex,
  segments = [],
  pendingRange = null,
  editRanges = false,
  knownLabels = [],
  onReplaceSegments,
  onFillGap,
  onDeleteSegment,
  onRenameSegment,
}) => {
  const { t } = useTranslation();
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const frameIndexRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastA11ySyncTimeRef = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const getCurrentTime = useCallback(
    (frameIndex: number) => {
      if (currentFrames[frameIndex]?.timestamp !== undefined) {
        return currentFrames[frameIndex].timestamp;
      }
      return frameIndex / fps;
    },
    [currentFrames, fps],
  );

  const updateProgressVisual = useCallback((fraction: number) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    if (progressRef.current) {
      progressRef.current.style.transform = `scaleX(${clamped})`;
    }
    if (thumbRef.current) {
      thumbRef.current.style.left = getThumbLeft(clamped);
    }
  }, []);

  const updateDraggingVisual = useCallback((isDragging: boolean) => {
    if (trackRef.current) {
      trackRef.current.classList.toggle('cursor-grabbing', isDragging);
    }
    if (thumbRef.current) {
      thumbRef.current.classList.toggle('shadow-md', isDragging);
    }
  }, []);

  const updateA11y = useCallback(
    (frameIndex: number) => {
      if (!trackRef.current) return;
      trackRef.current.setAttribute('aria-valuenow', String(frameIndex));
      trackRef.current.setAttribute(
        'aria-valuetext',
        t('playback.a11y.valuetext', {
          time: formatTime(getCurrentTime(frameIndex)),
          totalTime: formatTime(totalTime),
          frame: frameIndex,
          totalFrames,
        }),
      );
    },
    [getCurrentTime, t, totalFrames, totalTime],
  );

  const syncFrameDisplay = useCallback(
    (frameIndex: number, syncA11y: boolean) => {
      if (currentTimeRef.current) {
        currentTimeRef.current.textContent = formatTime(getCurrentTime(frameIndex));
      }
      if (frameIndexRef.current) {
        frameIndexRef.current.textContent = String(frameIndex);
      }

      if (totalFrames > 0) {
        updateProgressVisual(frameIndex / Math.max(1, totalFrames - 1));
      } else {
        updateProgressVisual(0);
      }

      if (syncA11y) {
        updateA11y(frameIndex);
        lastA11ySyncTimeRef.current = Date.now();
      }
    },
    [getCurrentTime, totalFrames, updateA11y, updateProgressVisual],
  );

  const commitFrameIndex = useCallback(
    (frameIndex: number, syncA11y = true) => {
      setFrameIndex(frameIndex);
      syncFrameDisplay(frameIndex, syncA11y);
    },
    [setFrameIndex, syncFrameDisplay],
  );

  const seekToPercent = useCallback(
    (percent: number) => {
      if (totalFrames === 0) return;
      const clamped = Math.max(0, Math.min(1, percent));
      const nextIndex = Math.round(clamped * (totalFrames - 1));
      commitFrameIndex(nextIndex);
    },
    [commitFrameIndex, totalFrames],
  );

  const updatePositionFromClientX = useCallback(
    (clientX: number) => {
      if (!trackRef.current || totalFrames === 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const percent = (clientX - rect.left) / rect.width;
      seekToPercent(percent);
    },
    [seekToPercent, totalFrames],
  );

  const handleTrackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isDisabled || totalFrames === 0) return;

      const current = getFrameIndex();
      let nextIndex: number | null = null;
      switch (e.key) {
        case 'ArrowLeft':
          nextIndex = Math.max(0, current - 1);
          break;
        case 'ArrowRight':
          nextIndex = Math.min(totalFrames - 1, current + 1);
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = totalFrames - 1;
          break;
        case 'PageDown':
          nextIndex = Math.max(0, current - 10);
          break;
        case 'PageUp':
          nextIndex = Math.min(totalFrames - 1, current + 10);
          break;
        default:
          break;
      }

      if (nextIndex !== null) {
        e.preventDefault();
        commitFrameIndex(nextIndex);
      }
    },
    [commitFrameIndex, getFrameIndex, isDisabled, totalFrames],
  );

  const handleTrackPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!trackRef.current || isDisabled || totalFrames === 0) return;

      dragCleanupRef.current?.();
      isDraggingRef.current = true;
      updateDraggingVisual(true);
      trackRef.current.setPointerCapture(e.pointerId);

      updatePositionFromClientX(e.clientX);

      const handlePointerMove = (event: PointerEvent) => {
        if (!isDraggingRef.current) return;
        updatePositionFromClientX(event.clientX);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        dragCleanupRef.current = null;
      };

      const handlePointerUp = (event: PointerEvent) => {
        isDraggingRef.current = false;
        updateDraggingVisual(false);
        if (trackRef.current?.hasPointerCapture(event.pointerId)) {
          trackRef.current.releasePointerCapture(event.pointerId);
        }
        cleanup();
      };

      dragCleanupRef.current = cleanup;
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [isDisabled, totalFrames, updateDraggingVisual, updatePositionFromClientX],
  );

  useEffect(() => {
    const frameIndex = totalFrames > 0 ? Math.min(getFrameIndex(), totalFrames - 1) : 0;
    syncFrameDisplay(frameIndex, true);
  }, [getFrameIndex, syncFrameDisplay, totalFrames]);

  useEffect(() => {
    const unsubscribe = subscribeFrameIndex((frameIndex) => {
      if (isDraggingRef.current) return;
      const now = Date.now();
      const shouldSyncA11y = now - lastA11ySyncTimeRef.current >= A11Y_SYNC_INTERVAL_MS;
      syncFrameDisplay(frameIndex, shouldSyncA11y);
    });

    return unsubscribe;
  }, [subscribeFrameIndex, syncFrameDisplay]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const initialTime = useMemo(
    () => formatTime(getCurrentTime(initialFrameIndex)),
    [getCurrentTime, initialFrameIndex],
  );
  const initialA11yText = useMemo(() => {
    return t('playback.a11y.valuetext', {
      time: formatTime(getCurrentTime(initialFrameIndex)),
      totalTime: formatTime(totalTime),
      frame: initialFrameIndex,
      totalFrames,
    });
  }, [getCurrentTime, initialFrameIndex, t, totalFrames, totalTime]);
  const metricValueClassName =
    'text-xs font-mono font-semibold tabular-nums whitespace-nowrap text-foreground';
  const metricSupportClassName = 'text-[10px] font-mono tabular-nums text-muted-foreground';

  return (
    <div className="flex-1 flex flex-col justify-center gap-1.5 px-2">
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col justify-end">
          <div className="flex items-baseline gap-1.5" title={t('playback.progress')}>
            <span
              ref={currentTimeRef}
              className={metricValueClassName}
              style={{ minWidth: '8ch', display: 'inline-block' }}
            >
              {initialTime}
            </span>
            <span className={metricSupportClassName}>/ {formatTime(totalTime)}</span>
          </div>
        </div>
        <div className="flex min-w-[96px] flex-col items-end justify-end">
          <div className="flex items-baseline gap-1.5" title={t('units.frame')}>
            <span
              ref={frameIndexRef}
              className={metricValueClassName}
              style={{ minWidth: '4ch', display: 'inline-block', textAlign: 'right' }}
            >
              {initialFrameIndex}
            </span>
            <span className={metricSupportClassName}>/ {totalFrames}</span>
          </div>
        </div>
      </div>

      {editRanges || segments.length > 0 || pendingRange ? (
        <SubtaskRangeTrack
          segments={segments}
          knownLabels={knownLabels}
          totalFrames={totalFrames}
          editable={editRanges}
          onJump={setFrameIndex}
          pendingRange={pendingRange}
          onCommit={(next) => onReplaceSegments?.(next)}
          onFillGap={editRanges ? onFillGap : undefined}
          onDelete={editRanges ? onDeleteSegment : undefined}
          onRename={editRanges ? onRenameSegment : undefined}
        />
      ) : null}

      <div
        ref={trackRef}
        className="relative h-1.5 w-full cursor-pointer rounded-full bg-primary/20 touch-none"
        onPointerDown={handleTrackPointerDown}
        onKeyDown={handleTrackKeyDown}
        role="slider"
        tabIndex={isDisabled ? -1 : 0}
        aria-disabled={isDisabled}
        aria-label={t('playback.progress')}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, totalFrames - 1)}
        aria-valuenow={initialFrameIndex}
        aria-valuetext={initialA11yText}
      >
        {totalFrames > 1 && pendingRange ? (
          <div
            className="absolute top-0 h-full rounded-full pointer-events-none bg-primary/30"
            style={{
              left: `${(pendingRange.startFrame / (totalFrames - 1)) * 100}%`,
              width: `${Math.max(
                ((pendingRange.endFrame - pendingRange.startFrame + 1) / totalFrames) * 100,
                0.5,
              )}%`,
            }}
          />
        ) : null}
        <div
          ref={progressRef}
          className="absolute h-full rounded-full bg-primary/70 pointer-events-none"
          style={{
            width: '100%',
            transform: `scaleX(${totalFrames > 1 ? initialFrameIndex / (totalFrames - 1) : 0})`,
            transformOrigin: 'left center',
          }}
        />
        <div
          ref={thumbRef}
          className="absolute left-0 top-1/2 h-4 w-4 rounded-full border border-primary/50 bg-background transition-shadow will-change-transform hover:shadow-md"
          style={{
            left: getThumbLeft(totalFrames > 1 ? initialFrameIndex / (totalFrames - 1) : 0),
            transform: 'translateY(-50%)',
          }}
        />
      </div>
    </div>
  );
};

export const PlaybackProgressSlider = memo(PlaybackProgressSliderComponent);
PlaybackProgressSlider.displayName = 'PlaybackProgressSlider';
