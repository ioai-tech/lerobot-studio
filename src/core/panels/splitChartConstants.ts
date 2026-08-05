export const SPLIT_CHART_SYNC_KEY = 'lerobot-split';

export const SPLIT_CHART_HEIGHT_BASE = 200;
export const SPLIT_ROW_CHROME_HEIGHT = 44;

export function splitChartHeightForVisibleCount(visibleCount: number): number {
  if (visibleCount === 1) return SPLIT_CHART_HEIGHT_BASE * 4;
  if (visibleCount === 2) return SPLIT_CHART_HEIGHT_BASE * 2;
  return SPLIT_CHART_HEIGHT_BASE;
}

export function splitListRowHeightForVisibleCount(visibleCount: number): number {
  return SPLIT_ROW_CHROME_HEIGHT + splitChartHeightForVisibleCount(visibleCount);
}
