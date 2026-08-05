import type { FilterGroup } from './selectionModel';
import { groupJointNames } from './filterGrouping';
import type { ChartDimensionMeta } from './chartTypes';

/** Feature -> Joint Group -> Joint 三级筛选树顶层节点 */
export type FeatureFilterNode = {
  id: string;
  label: string;
  subgroups: FilterGroup[];
};

export function buildFeatureFilterTree(dimensions: ChartDimensionMeta[]): FeatureFilterNode[] {
  const byFeature = new Map<string, ChartDimensionMeta[]>();

  dimensions.forEach((dim) => {
    const bucket = byFeature.get(dim.featureKey) ?? [];
    bucket.push(dim);
    byFeature.set(dim.featureKey, bucket);
  });

  return Array.from(byFeature.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([featureKey, dims]) => {
      const jointNames = dims.map((d) => d.jointName);
      const subgroups = groupJointNames(jointNames).map((group) => ({
        ...group,
        items: group.items.map((item) => {
          const dim = dims.find((d) => d.jointName === item.id);
          return {
            id: dim?.id ?? item.id,
            label: item.label,
          };
        }),
      }));

      return {
        id: featureKey,
        label: featureKey,
        subgroups,
      };
    });
}

export function getFeatureNodeItemIds(node: FeatureFilterNode): string[] {
  return node.subgroups.flatMap((group) => group.items.map((item) => item.id));
}

export function getAllFeatureFilterItemIds(nodes: FeatureFilterNode[]): string[] {
  return nodes.flatMap((node) => getFeatureNodeItemIds(node));
}

export function filterFeatureNodes(nodes: FeatureFilterNode[], query: string): FeatureFilterNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  return nodes
    .map((node) => {
      const featureMatch = node.label.toLowerCase().includes(q);
      if (featureMatch) return node;

      const subgroups = node.subgroups
        .map((group) => {
          const groupMatch = group.label.toLowerCase().includes(q);
          if (groupMatch) return group;
          const items = group.items.filter((item) => item.label.toLowerCase().includes(q));
          return { ...group, items };
        })
        .filter((group) => group.items.length > 0);

      return subgroups.length > 0 ? { ...node, subgroups } : null;
    })
    .filter((node): node is FeatureFilterNode => node != null);
}

export function getVisibleJointNamesFromSelected(
  dimensions: ChartDimensionMeta[],
  selectedIds: Set<string>,
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  dimensions.forEach((dim) => {
    if (!selectedIds.has(dim.id)) return;
    if (seen.has(dim.jointName)) return;
    seen.add(dim.jointName);
    order.push(dim.jointName);
  });
  return order;
}
