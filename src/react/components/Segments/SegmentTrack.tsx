import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { frameAtFraction, frameRangeStyle, segmentReviewDisplay, type Segment } from '@/core';
import { cn } from '@/ui';
import { REVIEW_TEXT, TRACK_LOOK } from './reviewDisplay';

type Range = { startFrame: number; endFrame: number };

function frameFromClientX(clientX: number, track: HTMLElement, totalFrames: number): number {
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0 || totalFrames <= 0) return 0;
  return frameAtFraction((clientX - rect.left) / rect.width, totalFrames);
}

export interface SegmentTrackProps {
  segments: Segment[];
  totalFrames: number;
  selectedId: string | null;
  editable: boolean;
  onSelect: (id: string) => void;
  /** Called once when an edge drag ends (one change per gesture). */
  onCommitRange: (id: string, range: Range) => void;
}

/**
 * The segment band above the subtask lane: one block per segment on the same
 * x-scale as the progress bar. Edge handles resize while dragging and commit
 * a single change on release.
 */
export const SegmentTrack: React.FC<SegmentTrackProps> = ({
  segments,
  totalFrames,
  selectedId,
  editable,
  onSelect,
  onCommitRange,
}) => {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ id: string; range: Range } | null>(null);
  const draftRef = useRef<{ id: string; range: Range } | null>(null);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, index: number, edge: 'start' | 'end') => {
      if (!editable || !trackRef.current || totalFrames <= 1) return;
      event.preventDefault();
      event.stopPropagation();
      const segment = segments[index];
      const previous = segments[index - 1];
      const next = segments[index + 1];
      const minStart = previous ? previous.endFrame + 1 : 0;
      const maxEnd = next ? next.startFrame - 1 : totalFrames - 1;
      const initial = { id: segment.id, range: { ...segment } };
      draftRef.current = initial;
      setDraft(initial);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const frame = frameFromClientX(moveEvent.clientX, trackRef.current!, totalFrames);
        // The gesture stays between the neighbours; the commit is still validated.
        const range =
          edge === 'start'
            ? {
                startFrame: Math.max(minStart, Math.min(frame, segment.endFrame)),
                endFrame: segment.endFrame,
              }
            : {
                startFrame: segment.startFrame,
                endFrame: Math.min(maxEnd, Math.max(frame, segment.startFrame)),
              };
        draftRef.current = { id: segment.id, range };
        setDraft(draftRef.current);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        const final = draftRef.current;
        draftRef.current = null;
        setDraft(null);
        if (
          final &&
          (final.range.startFrame !== segment.startFrame ||
            final.range.endFrame !== segment.endFrame)
        ) {
          onCommitRange(final.id, final.range);
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [editable, onCommitRange, segments, totalFrames],
  );

  if (totalFrames <= 1 || segments.length === 0) return null;

  return (
    <div
      ref={trackRef}
      className="relative h-5 w-full rounded-md bg-muted/50"
      role="list"
      aria-label={t('segments.track')}
      data-testid="lerobot-segment-track"
    >
      {segments.map((segment, index) => {
        const range = draft?.id === segment.id ? draft.range : segment;
        const position = frameRangeStyle(range.startFrame, range.endFrame, totalFrames);
        const selected = segment.id === selectedId;
        const display = segmentReviewDisplay(segment);
        const label = t('segments.trackSegment', { n: index + 1 });
        const reviewText = t(REVIEW_TEXT[display]);
        return (
          <div key={segment.id} role="listitem" className="absolute inset-y-0" style={position}>
            <button
              type="button"
              className={cn(
                'h-full w-full min-w-1 overflow-hidden rounded-sm border px-1 text-left text-[10px] leading-4 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                TRACK_LOOK[display],
                selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                segment.status?.severity === 'fail' && 'border-destructive',
              )}
              aria-label={`${label}, ${reviewText}`}
              aria-pressed={selected}
              data-review={display}
              title={`${label} · ${reviewText}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(segment.id);
              }}
            >
              <span className="pointer-events-none block truncate">#{index + 1}</span>
            </button>
            {editable && !segment.readOnly ? (
              <>
                <span
                  role="presentation"
                  data-testid={`segment-handle-start-${index + 1}`}
                  className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize rounded-l-sm bg-foreground/40 hover:bg-foreground/70"
                  onPointerDown={(event) => startDrag(event, index, 'start')}
                />
                <span
                  role="presentation"
                  data-testid={`segment-handle-end-${index + 1}`}
                  className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize rounded-r-sm bg-foreground/40 hover:bg-foreground/70"
                  onPointerDown={(event) => startDrag(event, index, 'end')}
                />
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
