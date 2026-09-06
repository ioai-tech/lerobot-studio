import { Slider } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import type { EpisodeTrimRange } from '@/core';
import { Button, Input } from '@/ui';

export function EpisodeTrimControls({
  range,
  totalFrames,
  fps,
  disabled,
  onChange,
  getFrameIndex,
  onPause,
  preview,
  onPreviewChange,
}: {
  range: EpisodeTrimRange;
  totalFrames: number;
  fps: number;
  disabled: boolean;
  onChange: (range: EpisodeTrimRange | null) => void;
  getFrameIndex: () => number;
  onPause: () => void;
  preview: boolean;
  onPreviewChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const change = (startFrame: number, endFrame: number) => {
    if (
      disabled ||
      !Number.isSafeInteger(startFrame) ||
      !Number.isSafeInteger(endFrame) ||
      startFrame < 0 ||
      endFrame >= totalFrames ||
      startFrame > endFrame
    )
      return;
    onPause();
    onChange({ startFrame, endFrame });
  };
  return (
    <div className="space-y-2 py-1" aria-label={t('trim.title')}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          {t('trim.start')}
          <Input
            className="h-7 w-20"
            type="number"
            min={0}
            max={range.endFrame}
            step={1}
            value={range.startFrame}
            disabled={disabled}
            aria-label={t('trim.start')}
            onChange={(event) => change(event.target.valueAsNumber, range.endFrame)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => change(Math.min(getFrameIndex(), range.endFrame), range.endFrame)}
        >
          {t('trim.setStart')}
        </Button>
        <label className="flex items-center gap-1">
          {t('trim.end')}
          <Input
            className="h-7 w-20"
            type="number"
            min={range.startFrame}
            max={totalFrames - 1}
            step={1}
            value={range.endFrame}
            disabled={disabled}
            aria-label={t('trim.end')}
            onChange={(event) => change(range.startFrame, event.target.valueAsNumber)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => change(range.startFrame, Math.max(getFrameIndex(), range.startFrame))}
        >
          {t('trim.setEnd')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            onPause();
            onChange(null);
          }}
        >
          {t('trim.reset')}
        </Button>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={preview}
            disabled={disabled}
            onChange={(event) => {
              onPause();
              onPreviewChange(event.target.checked);
            }}
          />
          {t('trim.preview')}
        </label>
      </div>
      <Slider.Root
        value={[range.startFrame, range.endFrame]}
        min={0}
        max={Math.max(1, totalFrames - 1)}
        step={1}
        disabled={disabled || totalFrames < 2}
        minStepsBetweenThumbs={0}
        onValueChange={([start, end]) => change(start, end)}
        className="relative flex h-5 w-full touch-none items-center select-none"
      >
        <Slider.Track className="relative h-2 grow rounded bg-muted">
          <Slider.Range className="absolute h-full rounded bg-primary/70" />
        </Slider.Track>
        {[t('trim.startHandle'), t('trim.endHandle')].map((label) => (
          <Slider.Thumb
            key={label}
            aria-label={label}
            className="block h-5 w-3 rounded border border-primary bg-background focus-visible:outline-2 focus-visible:outline-primary"
          />
        ))}
      </Slider.Root>
      <p className="text-xs text-muted-foreground" role="status">
        {t('trim.summary', {
          original: totalFrames,
          kept: range.endFrame - range.startFrame + 1,
          start: (range.startFrame / fps).toFixed(2),
          end: ((range.endFrame + 1) / fps).toFixed(2),
        })}
      </p>
    </div>
  );
}
