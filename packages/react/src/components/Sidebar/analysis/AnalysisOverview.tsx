import React from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Database, Frame, Activity, Cpu, Bot } from 'lucide-react';

interface AnalysisOverviewProps {
  episodeCount: number;
  totalFrames: number;
  fps: number;
  codebaseVersion: string;
  robotType?: string;
}

export const AnalysisOverview: React.FC<AnalysisOverviewProps> = ({
  episodeCount,
  totalFrames,
  fps,
  codebaseVersion,
  robotType,
}) => {
  const { t } = useTranslation();

  const rows = [
    { icon: Database, label: t('analysis.episodeCount'), value: String(episodeCount) },
    { icon: Frame, label: t('analysis.totalFrames'), value: totalFrames.toLocaleString() },
    { icon: Activity, label: t('analysis.fps'), value: String(fps) },
    { icon: Cpu, label: t('analysis.version'), value: codebaseVersion },
    ...(robotType ? [{ icon: Bot, label: t('analysis.robotType'), value: robotType }] : []),
  ];

  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t('analysis.overview')}</span>
      </h3>
      <div className="min-w-0 overflow-hidden rounded border border-border/40">
        {rows.map(({ icon: Icon, label, value }, index) => (
          <div
            key={label}
            className={`flex min-w-0 items-center justify-between gap-3 px-2.5 py-2 ${
              index < rows.length - 1 ? 'border-b border-border/30' : ''
            }`}
          >
            <span className="flex min-w-0 shrink items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icon className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </span>
            <span
              className="min-w-0 shrink-0 max-w-[55%] truncate text-right font-mono text-xs font-semibold text-foreground"
              title={value}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};
