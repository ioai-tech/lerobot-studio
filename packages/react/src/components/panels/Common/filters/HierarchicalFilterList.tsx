import { memo, useEffect, useMemo, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@ioai/lerobot-studio-ui';
import { Button } from '@ioai/lerobot-studio-ui';
import { cn } from '@ioai/lerobot-studio-ui';
import type { FilterGroup } from '@ioai/lerobot-studio-core';
import { filterGroups, getGroupSelectionState } from '@ioai/lerobot-studio-core';

type HoverPayload =
  | { type: 'group'; id: string; itemIds: string[] }
  | { type: 'item'; id: string; itemIds: string[] };

interface HierarchicalFilterListProps {
  groups: FilterGroup[];
  selectedIds: Set<string>;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSetItemsChecked: (itemIds: string[], checked: boolean) => void;
  onToggleItem: (itemId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  searchPlaceholder: string;
  emptyLabel: string;
  selectAllLabel: string;
  onHoverChange?: (payload: HoverPayload | null) => void;
  getItemColor?: (itemId: string) => string | undefined;
  getGroupColor?: (groupId: string, itemIds: string[]) => string | undefined;
  className?: string;
}

const TriStateCheckbox = memo(function TriStateCheckbox({
  checked,
  indeterminate,
}: {
  checked: boolean;
  indeterminate: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    // 显式同步 DOM checkbox 状态，避免在只读受控场景下出现视觉滞后。
    ref.current.checked = checked;
    ref.current.indeterminate = indeterminate;
  }, [checked, indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      readOnly
      className="pointer-events-none h-3.5 w-3.5 shrink-0 rounded border-border accent-primary"
    />
  );
});

export const HierarchicalFilterList = memo(function HierarchicalFilterList({
  groups,
  selectedIds,
  searchValue,
  onSearchChange,
  onSetItemsChecked,
  onToggleItem,
  onSelectAll,
  onClearAll,
  searchPlaceholder,
  emptyLabel,
  selectAllLabel,
  onHoverChange,
  getItemColor,
  getGroupColor,
  className,
}: HierarchicalFilterListProps) {
  const allItemIds = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => item.id)),
    [groups],
  );
  const filteredGroups = useMemo(() => filterGroups(groups, searchValue), [groups, searchValue]);
  const selectedCount = useMemo(
    () => allItemIds.reduce((count, id) => (selectedIds.has(id) ? count + 1 : count), 0),
    [allItemIds, selectedIds],
  );
  const allSelected = allItemIds.length > 0 && selectedCount === allItemIds.length;
  const noneSelected = selectedCount === 0;
  const allIndeterminate = !allSelected && !noneSelected;
  return (
    <div className={cn('w-full', className)} onMouseLeave={() => onHoverChange?.(null)}>
      <div className="border-b bg-muted/20 px-2 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-8 shrink-0 items-center rounded-md px-1"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (allSelected) onClearAll();
              else onSelectAll();
            }}
            title={selectAllLabel}
            aria-label={selectAllLabel}
          >
            <TriStateCheckbox checked={allSelected} indeterminate={allIndeterminate} />
          </button>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 bg-background pl-7 pr-7 text-xs"
            />
            {searchValue ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSearchChange('');
                }}
                aria-label="clear-search"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="max-h-[38vh] overflow-y-auto px-1 py-1">
        {filteredGroups.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          filteredGroups.map((group) => {
            const groupItemIds = group.items.map((item) => item.id);
            const groupState = getGroupSelectionState(group, selectedIds);

            return (
              <div key={group.id} className="mb-1 border-b border-border/40 pb-1 last:border-b-0">
                <button
                  type="button"
                  data-filter-row="true"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSetItemsChecked(groupItemIds, groupState !== 'all');
                  }}
                  onMouseEnter={() =>
                    onHoverChange?.({ type: 'group', id: group.id, itemIds: groupItemIds })
                  }
                >
                  <TriStateCheckbox
                    checked={groupState === 'all'}
                    indeterminate={groupState === 'partial'}
                  />
                  {getGroupColor ? (
                    <span
                      className="h-0.5 w-5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: getGroupColor(group.id, groupItemIds) ?? 'transparent',
                      }}
                    />
                  ) : null}
                  <span className="font-semibold text-foreground">{group.label}</span>
                </button>

                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-filter-row="true"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 pl-6 text-left text-[11px] hover:bg-muted/40',
                      selectedIds.has(item.id) ? 'bg-accent/40' : '',
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleItem(item.id);
                    }}
                    onMouseEnter={() =>
                      onHoverChange?.({ type: 'item', id: item.id, itemIds: [item.id] })
                    }
                  >
                    <TriStateCheckbox checked={selectedIds.has(item.id)} indeterminate={false} />
                    {getItemColor ? (
                      <span
                        className="h-0.5 w-5 shrink-0 rounded-full"
                        style={{ backgroundColor: getItemColor(item.id) ?? 'transparent' }}
                      />
                    ) : null}
                    <span
                      className={
                        selectedIds.has(item.id)
                          ? 'font-medium text-foreground'
                          : 'text-muted-foreground'
                      }
                    >
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
