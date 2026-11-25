import { useTranslation } from 'react-i18next';

/**
 * Loading state of the chart, laid out like the one plot that will replace it
 * (inset like its axes), so the panel is never blank and nothing moves when
 * the data arrives.
 */
export function ChartGroupsPlaceholder() {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={t('common.loading')}
      data-testid="feature-chart-placeholder"
    >
      <ChartPlotPlaceholder />
    </div>
  );
}

/** The plot area of a chart whose data is still loading, inset like the plot's axes. */
export function ChartPlotPlaceholder() {
  return (
    <div className="relative min-h-0 flex-1 pt-2 pr-3 pb-[24px] pl-[52px]">
      <div className="h-full w-full animate-pulse rounded-sm bg-muted/60 motion-reduce:animate-none" />
    </div>
  );
}
