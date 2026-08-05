import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/ui';

interface EpisodeFiltersProps {
  durationMin: string;
  durationMax: string;
  onDurationMinChange: (value: string) => void;
  onDurationMaxChange: (value: string) => void;
}

export const EpisodeFilters: React.FC<EpisodeFiltersProps> = ({
  durationMin,
  durationMax,
  onDurationMinChange,
  onDurationMaxChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
      <Input
        type="number"
        placeholder={t('sidebar.filterByDuration')}
        className="h-8 min-w-0 flex-1 basis-0 border border-border bg-muted/50 px-2 text-xs"
        value={durationMin}
        onChange={(e) => onDurationMinChange(e.target.value)}
        title={t('sidebar.filterByDuration')}
        min={0}
        step={0.1}
        aria-label={t('sidebar.filterByDuration')}
      />
      <span className="shrink-0 text-xs text-muted-foreground">-</span>
      <Input
        type="number"
        className="h-8 min-w-0 flex-1 basis-0 border border-border bg-muted/50 px-2 text-xs"
        value={durationMax}
        onChange={(e) => onDurationMaxChange(e.target.value)}
        min={0}
        step={0.1}
        aria-label={t('sidebar.filterByDuration')}
      />
    </div>
  );
};
