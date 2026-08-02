import { memo } from 'react';
import { ChevronDown, ListFilter } from 'lucide-react';

import { cn } from '@/ui';
import { Button } from '@/ui';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui';
import { NestedHierarchicalFilterList } from './NestedHierarchicalFilterList';
import type { FeatureFilterNode } from '@/core';

type HoverPayload =
  | { type: 'feature'; id: string; itemIds: string[] }
  | { type: 'group'; id: string; itemIds: string[] }
  | { type: 'item'; id: string; itemIds: string[] };

export type ChartJointFilterDropdownProps = {
  featureFilterNodes: FeatureFilterNode[];
  selectedIds: Set<string>;
  jointSearch: string;
  onSearchChange: (value: string) => void;
  onSetItemsChecked: (itemIds: string[], checked: boolean) => void;
  onToggleItem: (itemId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  searchPlaceholder: string;
  emptyLabel: string;
  selectAllLabel: string;
  /** Summary when trigger shows selection state */
  summaryAllLabel: string;
  summaryNoneLabel: string;
  summarySelectedCountLabel: (count: number) => string;
  totalSeriesCount: number;
  onHoverChange?: (payload: HoverPayload | null) => void;
  getItemColor?: (itemId: string) => string | undefined;
  onMenuOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
};

/**
 * 折线图面板关节筛选：Feature -> Joint Group -> Joint 三级结构。
 */
export const ChartJointFilterDropdown = memo(function ChartJointFilterDropdown({
  featureFilterNodes,
  selectedIds,
  jointSearch,
  onSearchChange,
  onSetItemsChecked,
  onToggleItem,
  onSelectAll,
  onClearAll,
  searchPlaceholder,
  emptyLabel,
  selectAllLabel,
  summaryAllLabel,
  summaryNoneLabel,
  summarySelectedCountLabel,
  totalSeriesCount,
  onHoverChange,
  getItemColor,
  onMenuOpenChange,
  triggerClassName,
  contentClassName,
  align = 'start',
  side = 'bottom',
  sideOffset = 4,
}: ChartJointFilterDropdownProps) {
  const n = selectedIds.size;
  const summary =
    totalSeriesCount > 0 && n === totalSeriesCount
      ? summaryAllLabel
      : n === 0
        ? summaryNoneLabel
        : summarySelectedCountLabel(n);

  return (
    <DropdownMenu onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 gap-1 px-2 text-xs outline-none hover:bg-muted/50 aria-expanded:bg-muted/30',
              triggerClassName,
            )}
          />
        }
      >
        <ListFilter className="h-3 w-3 shrink-0" />
        <span className="max-w-[100px] truncate">{summary}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn('w-80 max-h-[60vh] overflow-hidden', contentClassName)}
      >
        <NestedHierarchicalFilterList
          featureNodes={featureFilterNodes}
          selectedIds={selectedIds}
          searchValue={jointSearch}
          onSearchChange={onSearchChange}
          onSetItemsChecked={onSetItemsChecked}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
          onClearAll={onClearAll}
          searchPlaceholder={searchPlaceholder}
          emptyLabel={emptyLabel}
          selectAllLabel={selectAllLabel}
          onHoverChange={onHoverChange}
          getItemColor={getItemColor}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
