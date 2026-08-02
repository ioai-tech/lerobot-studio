import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { List, type RowComponentProps } from 'react-window';

import { cn } from '@ioai/lerobot-studio-ui';
import type { ChartDataCore } from '../chartPanelModel';
import {
  ChartJointFilterDropdown,
  type ChartJointFilterDropdownProps,
} from '../ChartJointFilterDropdown';
import { Sheet, SheetContent } from '@ioai/lerobot-studio-ui';
import { SplitJointMiniPlot } from './SplitJointMiniPlot';
import {
  splitChartHeightForVisibleCount,
  splitListRowHeightForVisibleCount,
} from '@ioai/lerobot-studio-core';

export type SplitChartsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chartCore: ChartDataCore;
  allJointNames: string[];
  selectedSeriesIds: Set<string>;
  /** 与主图工具栏同一套关节筛选（共用 NestedHierarchicalFilterList 与 `selectedSeriesIds` 状态）。 */
  jointFilterDropdownProps: ChartJointFilterDropdownProps;
  showAction: boolean;
  showState: boolean;
  hasAction: boolean;
  hasState: boolean;
};

type SplitRowExtra = {
  jointOrder: string[];
  chartCore: ChartDataCore;
  chartHeight: number;
  selectedSeriesIds: Set<string>;
  showAction: boolean;
  showState: boolean;
  hasAction: boolean;
  hasState: boolean;
  actionLabel: string;
  stateLabel: string;
};

function SplitJointRow(props: RowComponentProps<SplitRowExtra>) {
  const {
    index,
    style,
    ariaAttributes,
    jointOrder,
    chartCore,
    chartHeight,
    selectedSeriesIds,
    showAction,
    showState,
    hasAction,
    hasState,
    actionLabel,
    stateLabel,
  } = props;

  const jointName = jointOrder[index];
  if (!jointName) return null;
  const color = chartCore.jointColorMap[jointName] ?? '#94a3b8';

  return (
    <div {...ariaAttributes} style={style} className="box-border px-0 pr-6 py-2">
      <div className="mb-2 flex justify-center px-2">
        <span
          className="max-w-full truncate text-center text-xs font-semibold leading-tight"
          style={{ color }}
          title={jointName}
        >
          {jointName}
        </span>
      </div>
      <SplitJointMiniPlot
        jointName={jointName}
        core={chartCore}
        chartHeight={chartHeight}
        selectedSeriesIds={selectedSeriesIds}
        showAction={showAction}
        showState={showState}
        hasAction={hasAction}
        hasState={hasState}
        actionLabel={actionLabel}
        stateLabel={stateLabel}
      />
    </div>
  );
}

export function SplitChartsSheet({
  open,
  onOpenChange,
  chartCore,
  allJointNames,
  selectedSeriesIds,
  jointFilterDropdownProps,
  showAction,
  showState,
  hasAction,
  hasState,
}: SplitChartsSheetProps) {
  const { t } = useTranslation();

  const orderedVisible = useMemo(() => allJointNames, [allJointNames]);

  const visibleCount = orderedVisible.length;
  const chartHeight = splitChartHeightForVisibleCount(visibleCount);
  const listRowHeight = splitListRowHeightForVisibleCount(visibleCount);

  const rowProps = useMemo(
    () =>
      ({
        jointOrder: orderedVisible,
        chartCore,
        chartHeight,
        selectedSeriesIds,
        showAction,
        showState,
        hasAction,
        hasState,
        actionLabel: t('chart.series.action'),
        stateLabel: t('chart.series.state'),
      }) satisfies SplitRowExtra,
    [
      orderedVisible,
      chartCore,
      chartHeight,
      selectedSeriesIds,
      showAction,
      showState,
      hasAction,
      hasState,
      t,
    ],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[640px] max-w-[90vw] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="flex shrink-0 items-center border-b border-border/60 bg-muted/20 px-3 py-2">
          <ChartJointFilterDropdown
            {...jointFilterDropdownProps}
            contentClassName={cn(
              'w-80 max-h-[min(55vh,380px)] overflow-hidden',
              jointFilterDropdownProps.contentClassName,
            )}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-1 pb-4">
          {visibleCount === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {t('chart.split.emptySelection')}
            </div>
          ) : (
            <List
              rowHeight={listRowHeight}
              rowCount={visibleCount}
              rowComponent={SplitJointRow}
              rowProps={rowProps}
              className="h-full w-full"
              style={{ height: '100%', width: '100%' }}
              overscanCount={2}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
