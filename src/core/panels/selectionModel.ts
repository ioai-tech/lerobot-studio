export type SelectionState = 'all' | 'partial' | 'none';

export interface FilterItem {
  id: string;
  label: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  items: FilterItem[];
}

export function getGroupSelectionState(
  group: FilterGroup,
  selectedIds: Set<string>,
): SelectionState {
  if (group.items.length === 0) return 'none';
  let selectedCount = 0;
  for (const item of group.items) {
    if (selectedIds.has(item.id)) selectedCount++;
  }
  if (selectedCount === 0) return 'none';
  if (selectedCount === group.items.length) return 'all';
  return 'partial';
}

export function applyGroupSelection(
  selectedIds: Set<string>,
  itemIds: string[],
  checked: boolean,
): Set<string> {
  const next = new Set(selectedIds);
  if (checked) {
    itemIds.forEach((id) => next.add(id));
  } else {
    itemIds.forEach((id) => next.delete(id));
  }
  return next;
}

export function toggleItemSelection(selectedIds: Set<string>, itemId: string): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  return next;
}

export function selectAll(itemIds: string[]): Set<string> {
  return new Set(itemIds);
}

export function clearAll(): Set<string> {
  return new Set();
}

export function filterGroups(groups: FilterGroup[], query: string): FilterGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;

  return groups
    .map((group) => {
      const groupMatch = group.label.toLowerCase().includes(q);
      if (groupMatch) return group;
      const items = group.items.filter((item) => item.label.toLowerCase().includes(q));
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);
}
