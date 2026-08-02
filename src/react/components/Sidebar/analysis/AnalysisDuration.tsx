import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';

interface AnalysisDurationProps {
  totalSec: number;
  avgSec: number;
  minSec: number;
  maxSec: number;
  lengthStats: { min: number; avg: number; max: number };
}

function formatDuration(sec: number, t: (key: string) => string): string {
  if (sec >= 60) {
    const min = sec / 60;
    return `${min.toFixed(1)} ${t('units.minute.short')}`;
  }
  return `${sec.toFixed(1)} ${t('units.second.short')}`;
}

export const AnalysisDuration: React.FC<AnalysisDurationProps> = ({
  totalSec,
  avgSec,
  minSec,
  maxSec,
  lengthStats,
}) => {
  const { t } = useTranslation();

  const avgPosition =
    lengthStats.max > lengthStats.min
      ? ((lengthStats.avg - lengthStats.min) / (lengthStats.max - lengthStats.min)) * 100
      : 50;

  const rows = [
    { label: t('analysis.totalDuration'), value: formatDuration(totalSec, t), highlight: true },
    { label: t('analysis.minDuration'), value: formatDuration(minSec, t), highlight: false },
    { label: t('analysis.avgDuration'), value: formatDuration(avgSec, t), highlight: false },
    { label: t('analysis.maxDuration'), value: formatDuration(maxSec, t), highlight: false },
  ];

  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t('analysis.duration')}</span>
      </h3>
      <div className="min-w-0 overflow-hidden rounded border border-border/40">
        {rows.map(({ label, value, highlight }, index) => (
          <div
            key={label}
            className={`flex min-w-0 items-center justify-between gap-3 px-2.5 py-2 ${
              index < rows.length - 1 ? 'border-b border-border/30' : ''
            } ${highlight ? 'bg-primary/5' : ''}`}
          >
            <span
              className={`truncate text-[11px] ${
                highlight ? 'font-medium text-primary' : 'text-muted-foreground'
              }`}
            >
              {label}
            </span>
            <span
              className={`shrink-0 font-mono text-xs font-semibold ${
                highlight ? 'text-primary' : 'text-foreground'
              }`}
              title={value}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="min-w-0 overflow-hidden rounded border border-border/40 px-2.5 py-2 space-y-1.5">
        <div className="flex min-w-0 items-center justify-between text-[10px] font-medium text-muted-foreground">
          <span>{t('analysis.min')}</span>
          <span>{t('analysis.avg')}</span>
          <span>{t('analysis.max')}</span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-0 rounded-full bg-primary/30" />
          <div
            className="absolute top-0 h-full w-1.5 -translate-x-1/2 rounded-full bg-primary"
            style={{ left: `${avgPosition}%` }}
          />
        </div>
        <div className="flex min-w-0 items-center justify-between font-mono text-xs">
          <span className="text-muted-foreground">{lengthStats.min}</span>
          <span className="font-semibold">{lengthStats.avg}</span>
          <span className="text-muted-foreground">{lengthStats.max}</span>
        </div>
        <div className="text-center text-[9px] uppercase tracking-wider text-muted-foreground">
          {t('units.frame')}
        </div>
      </div>
    </section>
  );
};
