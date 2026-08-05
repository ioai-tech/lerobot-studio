import React from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart } from 'lucide-react';

interface AnalysisTaskDistributionProps {
  taskEntries: Array<[string, number]>;
  episodeCount: number;
}

export const AnalysisTaskDistribution: React.FC<AnalysisTaskDistributionProps> = ({
  taskEntries,
  episodeCount,
}) => {
  const { t } = useTranslation();

  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <PieChart className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t('analysis.taskDistribution')}</span>
      </h3>
      <div className="min-w-0 flex flex-col gap-1.5">
        {taskEntries.map(([task, count]) => {
          const percentage = ((count / episodeCount) * 100).toFixed(1);
          return (
            <div
              key={task}
              className="min-w-0 overflow-hidden rounded border border-border/40 px-2.5 py-2 space-y-1.5"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <span className="min-w-0 flex-1 break-words whitespace-normal text-xs font-medium leading-tight text-foreground/90">
                  {task || t('sidebar.noDescription')}
                </span>
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <span className="font-mono text-xs font-semibold">{count}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{percentage}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
                <div
                  className="h-full rounded-full bg-primary/60 transition-all"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
