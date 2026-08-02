import type { FilterGroup } from './selectionModel';

const JOINT_GROUP_ORDER = [
  'left',
  'right',
  'head',
  'arm',
  'leg',
  'wrist',
  'gripper',
  'other',
] as const;

function isLeft(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('left') || lower.startsWith('l_') || /[_]l[_]/.test(lower) || /[_]l$/.test(lower)
  );
}

function isRight(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('right') ||
    lower.startsWith('r_') ||
    /[_]r[_]/.test(lower) ||
    /[_]r$/.test(lower)
  );
}

export function classifyJoint(name: string): (typeof JOINT_GROUP_ORDER)[number] {
  const lower = name.toLowerCase();
  if (isLeft(name)) return 'left';
  if (isRight(name)) return 'right';
  if (lower.includes('head') || lower.includes('neck')) return 'head';
  if (lower.includes('arm') || lower.includes('shoulder') || lower.includes('elbow')) return 'arm';
  if (
    lower.includes('leg') ||
    lower.includes('knee') ||
    lower.includes('hip') ||
    lower.includes('ankle')
  )
    return 'leg';
  if (lower.includes('wrist')) return 'wrist';
  if (lower.includes('gripper') || lower.includes('finger') || lower.includes('hand'))
    return 'gripper';
  return 'other';
}

export function groupJointNames(names: string[]): FilterGroup[] {
  const map: Record<string, string[]> = {};
  JOINT_GROUP_ORDER.forEach((key) => {
    map[key] = [];
  });

  names.forEach((name) => {
    map[classifyJoint(name)].push(name);
  });

  const labels: Record<string, string> = {
    left: 'Left',
    right: 'Right',
    head: 'Head',
    arm: 'Arm',
    leg: 'Leg',
    wrist: 'Wrist',
    gripper: 'Gripper',
    other: 'Other',
  };

  return JOINT_GROUP_ORDER.map((key) => ({
    id: key,
    label: labels[key],
    items: map[key].sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, label: name })),
  })).filter((group) => group.items.length > 0);
}

export function groupFeatureKeys(keys: string[]): FilterGroup[] {
  const groups = new Map<string, string[]>();

  keys.forEach((key) => {
    const prefix = key.includes('.') ? key.split('.')[0] : 'general';
    const bucket = groups.get(prefix) ?? [];
    bucket.push(key);
    groups.set(prefix, bucket);
  });

  return Array.from(groups.entries())
    .map(([prefix, items]) => ({
      id: prefix,
      label: prefix === 'general' ? 'General' : prefix,
      items: items.sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, label: name })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
