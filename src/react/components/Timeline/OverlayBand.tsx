import { useTranslation } from 'react-i18next';
import { frameRangeFractions, frameToInTime, frameToOutTime, type OverlaySegment } from '@/core';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@/ui';

/**
 * Read-only segments from another process (for example proposals still being
 * made), in a band above the segment track on the same x-scale. Each block is
 * as tall as a segment block and carries its number, and neighbours alternate
 * in shade so dozens of them stay apart (s10 F-17). A click seeks to the
 * segment's first frame; nothing here edits.
 */
export function OverlayBand({
  segments,
  totalFrames,
  fps,
  onSeek,
}: {
  segments: readonly OverlaySegment[];
  totalFrames: number;
  fps: number;
  onSeek: (frame: number) => void;
}) {
  const { t } = useTranslation();
  if (totalFrames <= 0 || segments.length === 0) return null;
  const legend = t('overlay.legend');
  return (
    <div className="flex w-full flex-col gap-0.5" data-testid="lerobot-overlay-band">
      <span className="text-[10px] leading-none text-muted-foreground">{legend}</span>
      <div role="group" aria-label={legend} className="relative h-4 w-full">
        {segments.map((segment, index) => {
          const { left, width } = frameRangeFractions(
            segment.startFrame,
            Math.min(segment.endFrame, totalFrames - 1),
            totalFrames,
          );
          const time = `${frameToInTime(segment.startFrame, fps)}–${frameToOutTime(segment.endFrame, fps)}`;
          const confidence =
            segment.origin.kind === 'suggested' && segment.origin.confidence != null
              ? segment.origin.confidence.toFixed(2)
              : null;
          const name = t('overlay.item', { n: index + 1, time });
          return (
            <Tooltip key={segment.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    tabIndex={-1}
                    data-overlay-id={segment.id}
                    aria-label={segment.task ? `${name}, ${segment.task}` : name}
                    className={cn(
                      'absolute top-0 h-full overflow-hidden rounded-sm border border-dashed border-primary/70 px-0.5 text-left text-[10px] leading-[14px] font-medium text-foreground hover:bg-primary/45',
                      index % 2 === 0 ? 'bg-primary/20' : 'bg-primary/35',
                    )}
                    style={{
                      left: `${(left * 100).toFixed(4)}%`,
                      width: `max(3px, ${(width * 100).toFixed(4)}%)`,
                    }}
                    onClick={() => onSeek(segment.startFrame)}
                  />
                }
              >
                <span className="pointer-events-none block truncate" aria-hidden>
                  {index + 1}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span className="font-mono">{time}</span>
                {segment.task ? <span className="ml-1.5">{segment.task}</span> : null}
                {confidence ? <span className="ml-1.5 opacity-80">{confidence}</span> : null}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
