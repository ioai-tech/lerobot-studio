import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/ui';
import type { MediaDebugMetadata } from '@/core';

interface MediaDebugOverlayProps {
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
  metadata,
  translationPrefix,
  className,
}) => {
  const { t } = useTranslation();
  const [hoverArmed, setHoverArmed] = useState(false);

  useEffect(() => {
    const arm = () => setHoverArmed(true);
    window.addEventListener('mousemove', arm, { once: true });
    return () => window.removeEventListener('mousemove', arm);
  }, []);

  if (!metadata) {
    return null;
  }

  const items = [
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

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute left-2 top-2 z-10 max-h-[50%] max-w-[min(16rem,calc(100%-1rem))] overflow-y-auto rounded-md border border-white/10 bg-black/70 px-2.5 py-2 text-[11px] text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150',
        hoverArmed && 'group-hover:opacity-100 group-focus-within:opacity-100',
        className,
      )}
    >
      <dl className="flex flex-col gap-1">
        {items.map((item) => (
          <div
            key={item.label}
            className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0"
          >
            <dt className="shrink-0 text-white/55">{item.label}</dt>
            <dd className="min-w-0 break-all text-right font-mono tabular-nums text-white/95">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
