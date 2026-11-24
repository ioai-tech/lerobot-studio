import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  frameRangeFractions,
  frameToInTime,
  frameToOutTime,
  laneMarkerAt,
  type MarkerRow,
  type TimelineMarker,
  type TimelineMarkerLane,
} from '@/core';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@/ui';
import { useLeRobotData, useLeRobotSegments } from '../../contexts/LeRobotContext';
import { MARKER_STEP_KEYS } from '../../hooks/segmentShortcuts';

const SEVERITY_CLASS: Record<TimelineMarker['severity'], string> = {
  info: 'bg-sky-600 dark:bg-sky-400',
  warn: 'bg-amber-500',
  fail: 'bg-destructive',
};

/** Narrowest drawn marker, so a one-frame tick stays visible and clickable. */
const MIN_MARKER_PX = 3;

/**
 * Host markers on the episode's time axis (same x-scale as the slider). One
 * tab stop; arrow keys move between markers; Enter or a click seeks to the
 * marker's first frame.
 */
export function MarkerLane({
  markers,
  totalFrames,
  fps,
  onSeek,
  label,
}: {
  markers: readonly TimelineMarker[];
  totalFrames: number;
  fps: number;
  onSeek: (frame: number) => void;
  /** The row's accessible name. @defaultValue the `markers.label` message */
  label?: string;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  if (totalFrames <= 0 || markers.length === 0) return null;
  const current = Math.min(active, markers.length - 1);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? markers.length - 1
          : (current + step + markers.length) % markers.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label ?? t('markers.label')}
      className="relative h-2.5 w-full"
      data-testid="lerobot-marker-lane"
      onKeyDown={onKeyDown}
    >
      {markers.map((marker, index) => {
        const { left, width } = frameRangeFractions(
          marker.startFrame,
          Math.min(marker.endFrame, totalFrames - 1),
          totalFrames,
        );
        const time = `${frameToInTime(marker.startFrame, fps)}–${frameToOutTime(marker.endFrame, fps)}`;
        const severity = t(`markers.severity.${marker.severity}`);
        return (
          <Tooltip key={marker.id}>
            <TooltipTrigger
              render={
                <button
                  ref={(el) => {
                    refs.current[index] = el;
                  }}
                  type="button"
                  tabIndex={index === current ? 0 : -1}
                  data-marker-id={marker.id}
                  data-severity={marker.severity}
                  aria-label={t('markers.item', { label: marker.label, severity, time })}
                  className={cn(
                    'absolute top-0 h-full rounded-[2px] opacity-85 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    SEVERITY_CLASS[marker.severity],
                  )}
                  style={{
                    left: `${(left * 100).toFixed(4)}%`,
                    width: `max(${MIN_MARKER_PX}px, ${(width * 100).toFixed(4)}%)`,
                  }}
                  onFocus={() => setActive(index)}
                  onClick={() => onSeek(marker.startFrame)}
                />
              }
            />
            <TooltipContent>
              <span className="font-medium">{marker.label}</span>
              <span className="ml-1.5 opacity-80">
                {severity} · {time}
              </span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Every row of the marker lane for the shown episode: each declared lane under
 * a header with its name (a navigable lane adds its position and next /
 * previous buttons), then the default row, which keeps today's look.
 */
export function MarkerLanes({
  totalFrames,
  fps,
  onSeek,
}: {
  totalFrames: number;
  fps: number;
  onSeek: (frame: number) => void;
}) {
  const { markerRows } = useLeRobotSegments();
  if (totalFrames <= 0 || markerRows.length === 0) return null;
  return (
    <>
      {markerRows.map((row) =>
        row.lane ? (
          <div key={`lane-${row.lane.id}`} data-marker-lane={row.lane.id}>
            <MarkerLaneHeader lane={row.lane} row={row} />
            <MarkerLane
              markers={row.markers}
              totalFrames={totalFrames}
              fps={fps}
              onSeek={onSeek}
              label={row.lane.label}
            />
          </div>
        ) : (
          <MarkerLane
            key="default"
            markers={row.markers}
            totalFrames={totalFrames}
            fps={fps}
            onSeek={onSeek}
          />
        ),
      )}
    </>
  );
}

const LANE_BUTTON_CLASS =
  'inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function MarkerLaneHeader({ lane, row }: { lane: TimelineMarkerLane; row: MarkerRow }) {
  const { t } = useTranslation();
  const { markerStep, stepMarker } = useLeRobotSegments();
  const { subscribeFrameIndex, getFrameIndex } = useLeRobotData();
  const own = markerStep?.laneId === lane.id ? markerStep : null;
  const current = own?.markerId ?? null;
  const markers = row.markers;
  // The place shown follows the playhead: the marker it rests on, if any.
  const [restingOn, setRestingOn] = useState(() => laneMarkerAt(markers, current, getFrameIndex()));
  useEffect(() => {
    const update = (frame: number) => setRestingOn(laneMarkerAt(markers, current, frame));
    update(getFrameIndex());
    return subscribeFrameIndex(update);
  }, [current, getFrameIndex, markers, subscribeFrameIndex]);

  const total = markers.length;
  const values = { label: lane.label, total };
  const announcement = own
    ? t(own.announce, own.position != null ? { ...values, position: own.position } : values)
    : '';
  return (
    <div className="flex h-4 min-w-0 items-center gap-1.5 text-[10px] leading-4 text-muted-foreground">
      <span className="truncate font-medium">{lane.label}</span>
      {lane.navigable ? (
        <>
          <span className="tabular-nums" aria-hidden data-testid="lerobot-marker-lane-position">
            {restingOn >= 0 ? restingOn + 1 : '–'} / {total}
          </span>
          {/* Steps are announced; a playhead passing a marker is not. */}
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {/* A new key per step announces a repeated text (at the row's end) again. */}
            <span key={own?.at}>{announcement}</span>
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              className={LANE_BUTTON_CLASS}
              aria-label={t('markers.lane.previous', values)}
              title={`${t('markers.lane.previous', values)} (${MARKER_STEP_KEYS.previous})`}
              onClick={() => stepMarker(-1, lane.id)}
            >
              <ChevronLeft className="h-3 w-3" aria-hidden />
            </button>
            <button
              type="button"
              className={LANE_BUTTON_CLASS}
              aria-label={t('markers.lane.next', values)}
              title={`${t('markers.lane.next', values)} (${MARKER_STEP_KEYS.next})`}
              onClick={() => stepMarker(1, lane.id)}
            >
              <ChevronRight className="h-3 w-3" aria-hidden />
            </button>
          </span>
        </>
      ) : null}
    </div>
  );
}
