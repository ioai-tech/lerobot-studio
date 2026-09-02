import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { SubtaskSegment } from '@/core';
import type { PendingSubtaskRange } from '../../contexts/useSubtaskAnnotation';
import { buildSubtaskLane, colorForSubtaskLabel, resizeSubtaskClipEdge } from '@/core';
import { cn } from '@/ui';

function sameSegments(left: readonly SubtaskSegment[], right: readonly SubtaskSegment[]): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (segment, index) =>
      segment.label === right[index]?.label &&
      segment.startFrame === right[index]?.startFrame &&
      segment.endFrame === right[index]?.endFrame,
  );
}

function frameFromClientX(clientX: number, track: HTMLElement, totalFrames: number): number {
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0 || totalFrames <= 0) return 0;
  const percent = (clientX - rect.left) / rect.width;
  return Math.round(Math.max(0, Math.min(1, percent)) * (totalFrames - 1));
}

interface DragState {
  index: number;
  edge: 'start' | 'end';
}

export interface SubtaskRangeTrackProps {
  segments: SubtaskSegment[];
  knownLabels: string[];
  totalFrames: number;
  editable: boolean;
  pendingRange?: PendingSubtaskRange | null;
  onJump: (frameIndex: number) => void;
  onCommit: (segments: SubtaskSegment[]) => void;
  onFillGap?: (startFrame: number, endFrame: number) => void;
  onDelete?: (index: number) => void;
  onRename?: (index: number) => void;
}

export const SubtaskRangeTrack: React.FC<SubtaskRangeTrackProps> = ({
  segments,
  knownLabels,
  totalFrames,
  editable,
  pendingRange = null,
  onJump,
  onCommit,
  onFillGap,
  onDelete,
  onRename,
}) => {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const draftRef = useRef<SubtaskSegment[] | null>(null);
  const [draft, setDraft] = useState<SubtaskSegment[] | null>(null);
  const visible = draft ?? segments;
  const lane = useMemo(() => buildSubtaskLane(visible, totalFrames), [totalFrames, visible]);

  const applyDrag = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const drag = dragRef.current;
      if (!track || !drag) return;
      const frame = frameFromClientX(clientX, track, totalFrames);
      try {
        const next = resizeSubtaskClipEdge(segments, drag.index, drag.edge, frame, totalFrames);
        draftRef.current = next;
        setDraft(next);
      } catch {
        // Keep the last valid partition.
      }
    },
    [segments, totalFrames],
  );

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    const next = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (next && !sameSegments(segments, next)) onCommit(next);
  }, [onCommit, segments]);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, index: number, edge: 'start' | 'end') => {
      if (!editable || !trackRef.current || totalFrames <= 1) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { index, edge };
      draftRef.current = segments;
      setDraft(segments);
      event.currentTarget.setPointerCapture(event.pointerId);
      const handleMove = (moveEvent: PointerEvent) => applyDrag(moveEvent.clientX);
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
        stopDrag();
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
    },
    [applyDrag, editable, segments, stopDrag, totalFrames],
  );

  const handleTrackClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current) return;
      onJump(frameFromClientX(event.clientX, trackRef.current, totalFrames));
    },
    [onJump, totalFrames],
  );

  if (totalFrames <= 1 || (!editable && lane.length === 0)) return null;

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative flex h-4 w-full overflow-visible rounded-md bg-muted/80',
        editable && 'ring-1 ring-border',
      )}
      role="list"
      aria-label={t('subtask.rangeTrack', 'Subtasks')}
      onClick={handleTrackClick}
    >
      {lane.map((item) => {
        const width = ((item.endFrame - item.startFrame + 1) / totalFrames) * 100;
        const isSegment = item.kind === 'segment';
        const color = isSegment ? colorForSubtaskLabel(item.label, knownLabels) : undefined;
        return (
          <div
            key={`${item.kind}-${item.startFrame}-${item.endFrame}`}
            role="listitem"
            className={cn(
              'relative h-full min-w-0',
              isSegment ? 'group text-white' : 'bg-[length:8px_8px]',
              editable && !isSegment && onFillGap && 'cursor-pointer',
            )}
            style={{
              width: `${width}%`,
              backgroundColor: isSegment ? color : undefined,
              backgroundImage: isSegment
                ? undefined
                : 'repeating-linear-gradient(135deg, rgba(100,116,139,0.28) 0 4px, transparent 4px 8px)',
            }}
            title={
              isSegment
                ? `${item.label} ${item.startFrame}–${item.endFrame}`
                : t('subtask.unlabeledGap', 'Unlabeled {{start}}–{{end}}', {
                    start: item.startFrame,
                    end: item.endFrame,
                  })
            }
            onClick={(event) => {
              if (!editable || isSegment || !onFillGap) return;
              event.preventDefault();
              event.stopPropagation();
              onFillGap(item.startFrame, item.endFrame);
            }}
            onDoubleClick={(event) => {
              if (!editable || !isSegment || !onRename) return;
              event.preventDefault();
              event.stopPropagation();
              onRename(item.index);
            }}
          >
            {isSegment ? (
              <span className="pointer-events-none block truncate px-1 text-[10px] leading-4">
                {item.label}
              </span>
            ) : null}
            {editable && isSegment && onDelete ? (
              <button
                type="button"
                title={t('common.delete', 'Delete')}
                className="absolute top-0 right-0.5 z-20 flex h-3 w-3 items-center justify-center rounded-sm bg-black/40 text-white opacity-0 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.index);
                }}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            ) : null}
            {editable && isSegment ? (
              <>
                <button
                  type="button"
                  aria-label={t('subtask.resizeBoundary', 'Move boundary')}
                  className="absolute top-0 left-0 z-10 h-full w-1.5 cursor-ew-resize rounded-sm bg-background/90 shadow-sm ring-1 ring-border"
                  onPointerDown={(event) => startDrag(event, item.index, 'start')}
                  onClick={(event) => event.stopPropagation()}
                />
                <button
                  type="button"
                  aria-label={t('subtask.resizeBoundary', 'Move boundary')}
                  className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-ew-resize rounded-sm bg-background/90 shadow-sm ring-1 ring-border"
                  onPointerDown={(event) => startDrag(event, item.index, 'end')}
                  onClick={(event) => event.stopPropagation()}
                />
              </>
            ) : null}
          </div>
        );
      })}
      {pendingRange && totalFrames > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-[1] rounded-sm bg-primary/35 ring-1 ring-primary/70"
          style={{
            left: `${(pendingRange.startFrame / totalFrames) * 100}%`,
            width: `${((pendingRange.endFrame - pendingRange.startFrame + 1) / totalFrames) * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
};
