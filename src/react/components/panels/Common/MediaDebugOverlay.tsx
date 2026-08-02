import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/ui';
import type { MediaDebugMetadata } from '@/core';

interface MediaDebugOverlayProps {
  featureKey: string;
  metadata: MediaDebugMetadata | null;
  translationPrefix: 'panels.video.debug' | 'panels.image.debug';
  className?: string;
}

function formatResolution(metadata: MediaDebugMetadata): string | null {
  if (!metadata.width || !metadata.height) {
    return null;
  }

  return `${metadata.width} x ${metadata.height}`;
}

function formatTimeline(metadata: MediaDebugMetadata): string | null {
  if (!metadata.timeline) {
    return null;
  }

  return `${metadata.timeline.startSec.toFixed(2)}s - ${metadata.timeline.endSec.toFixed(2)}s`;
}

export const MediaDebugOverlay: React.FC<MediaDebugOverlayProps> = ({
  featureKey,
  metadata,
  translationPrefix,
  className,
}) => {
  const { t } = useTranslation();

  if (!metadata) {
    return null;
  }

  const items = [
    { label: t(`${translationPrefix}.feature`), value: featureKey, breakAll: true },
    { label: t(`${translationPrefix}.dtype`), value: metadata.dtype },
    {
      label: t(`${translationPrefix}.fps`),
      value: metadata.fps != null ? String(metadata.fps) : null,
    },
    { label: t(`${translationPrefix}.resolution`), value: formatResolution(metadata) },
    { label: t(`${translationPrefix}.codec`), value: metadata.codec },
    { label: t(`${translationPrefix}.pixelFormat`), value: metadata.pixelFormat },
    {
      label: t(`${translationPrefix}.channels`),
      value: metadata.channels != null ? String(metadata.channels) : null,
    },
    {
      label: t(`${translationPrefix}.hasAudio`),
      value:
        metadata.hasAudio == null
          ? null
          : metadata.hasAudio
            ? t(`${translationPrefix}.yes`)
            : t(`${translationPrefix}.no`),
    },
    { label: t(`${translationPrefix}.clipRange`), value: formatTimeline(metadata) },
  ].filter((item) => item.value);

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[10px] text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
        className,
      )}
    >
      <p className="shrink-0 font-semibold uppercase tracking-[0.12em] text-white/70">
        {t(`${translationPrefix}.title`)}
      </p>
      <dl className="flex min-w-0 items-center gap-2 overflow-hidden border-l border-white/15 pl-2">
        {items.map((item) => (
          <div
            key={item.label}
            className={cn('flex shrink-0 items-baseline gap-1', item.breakAll && 'min-w-0 shrink')}
          >
            <dt className="shrink-0 text-white/60">{item.label}</dt>
            <dd
              className={cn(
                'font-mono tabular-nums',
                item.breakAll && 'min-w-0 max-w-48 truncate',
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
