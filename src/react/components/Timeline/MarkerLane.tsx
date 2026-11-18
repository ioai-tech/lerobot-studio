import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { frameRangeFractions, frameToInTime, frameToOutTime, type TimelineMarker } from '@/core';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@/ui';

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
}: {
  markers: readonly TimelineMarker[];
  totalFrames: number;
  fps: number;
  onSeek: (frame: number) => void;
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
      aria-label={t('markers.label')}
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
