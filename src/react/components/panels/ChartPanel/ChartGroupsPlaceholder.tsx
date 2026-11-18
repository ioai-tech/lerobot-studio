import { useTranslation } from 'react-i18next';
import type { ChartGroup } from './chartGroupsModel';

/**
 * Loading state of the charts, laid out like the charts that will replace it
 * (one section per group, same flex sizing), so the panel is never blank and
 * nothing moves when the data arrives.
 */
export function ChartGroupsPlaceholder({ groups }: { groups: ChartGroup[] }) {
  const { t } = useTranslation();
  const shown = groups.length > 0 ? groups : [{ id: 'placeholder', title: '', series: [] }];
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={t('common.loading')}
      data-testid="chart-groups-placeholder"
    >
      {shown.map((group) => (
        <section
          key={group.id}
          aria-hidden
          className="flex min-h-[96px] flex-1 flex-col border-b border-border/50 last:border-b-0"
        >
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-1">
            <span className="text-[11px] font-semibold font-mono text-muted-foreground/70">
              {group.title}
            </span>
            {group.series.slice(0, 6).map((series) => (
              <span key={series.id} className="h-5 w-14 rounded border border-border/60" />
            ))}
          </header>
          <ChartPlotPlaceholder />
        </section>
      ))}
    </div>
  );
}

/** The plot area of a chart whose data is still loading, inset like the plot's axes. */
export function ChartPlotPlaceholder() {
  return (
    <div className="relative min-h-0 flex-1 pt-1.5 pr-2 pb-[24px] pl-[52px]">
      <div className="h-full w-full animate-pulse rounded-sm bg-muted/60 motion-reduce:animate-none" />
    </div>
  );
}
