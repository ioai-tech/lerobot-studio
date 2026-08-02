import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@ioai/lerobot-studio-ui';
import type { MediaDebugMetadata } from '@ioai/lerobot-studio-core';

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
        'pointer-events-none absolute left-2 top-2 z-10 max-w-[min(24rem,calc(100%-1rem))] rounded-md border border-white/10 bg-black/70 px-3 py-2 text-[11px] text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
        className,
      )}
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
        {t(`${translationPrefix}.title`)}
      </p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-1">
        {items.map((item) => (
          <React.Fragment key={item.label}>
            <dt className="text-white/60">{item.label}</dt>
            <dd
              className={cn(
                'font-mono text-right tabular-nums',
                item.breakAll && 'break-all text-left',
              )}
            >
              {item.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
};
