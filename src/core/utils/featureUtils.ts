/**
 * LeRobot特征检测工具函数
 */

import type { LeRobotInfo, LeRobotFeature } from '../types/lerobot';

/**
 * 检查特征是否是图像类型（保存在parquet中的嵌入图像）
 */
export function isImageFeature(feature: LeRobotFeature): boolean {
  return feature?.dtype === 'image';
}

/**
 * 检查特征是否是视频类型（保存为mp4文件）
 */
export function isVideoFeature(feature: LeRobotFeature): boolean {
  return feature?.dtype === 'video';
}

/**
 * 获取所有图像类型的特征名
 */
export function getImageFeatureNames(info: LeRobotInfo | null): string[] {
  if (!info?.features) return [];

  return Object.entries(info.features)
    .filter(([, feature]) => isImageFeature(feature))
    .map(([name]) => name);
}

/**
 * 获取所有视频类型的特征名
 */
export function getVideoFeatureNames(info: LeRobotInfo | null): string[] {
  if (!info?.features) return [];

  return Object.entries(info.features)
    .filter(([, feature]) => isVideoFeature(feature))
    .map(([name]) => name);
}

/**
 * 获取所有可视化（图像或视频）类型的特征名
 */
export function getVisualFeatureNames(info: LeRobotInfo | null): string[] {
  if (!info?.features) return [];

  return Object.entries(info.features)
    .filter(([, feature]) => isImageFeature(feature) || isVideoFeature(feature))
    .map(([name]) => name);
}

/**
 * 获取第一个可视化特征名（用于默认显示）
 */
export function getFirstVisualFeatureName(info: LeRobotInfo | null): string | null {
  const names = getVisualFeatureNames(info);
  return names.length > 0 ? names[0] : null;
}

/**
 * 检查数据集是否有视频文件
 * 如果 total_videos > 0，说明图像是以mp4格式保存的
 */
export function hasVideoFiles(info: LeRobotInfo | null): boolean {
  if (!info) return false;
  return (info.total_videos ?? 0) > 0;
}

/**
 * 检查数据集是否有嵌入图像（保存在parquet中）
 * 如果 total_videos === 0 且存在 dtype === 'image' 的特征
 */
export function hasEmbeddedImages(info: LeRobotInfo | null): boolean {
  if (!info) return false;
  const hasNoVideos = (info.total_videos ?? 0) === 0;
  const hasImageFeatures = getImageFeatureNames(info).length > 0;
  return hasNoVideos && hasImageFeatures;
}

/**
 * 确定特定特征应该使用什么类型的面板
 * 返回 'video' | 'image' | 'none'
 */
export function getFeatureDisplayType(
  info: LeRobotInfo | null,
  featureKey: string,
): 'video' | 'image' | 'none' {
  if (!info?.features) return 'none';

  const feature = info.features[featureKey];
  if (!feature) return 'none';

  if (isVideoFeature(feature)) {
    return 'video';
  }

  if (isImageFeature(feature)) {
    // 如果数据集有视频文件，图像特征也通过视频播放
    // 否则使用图像面板从parquet加载
    if (hasVideoFiles(info)) {
      return 'video';
    }
    return 'image';
  }

  return 'none';
}

/**
 * 获取所有数值类型的特征名（用于图表）
 */
export function getNumericalFeatureNames(info: LeRobotInfo | null): string[] {
  if (!info?.features) return [];

  return Object.entries(info.features)
    .filter(([key, feat]) => {
      if (key === 'timestamp') return true;
      if (!feat || !feat.dtype) return false;
      const dtype = feat.dtype.toLowerCase();
      return dtype.includes('float') || dtype.includes('int');
    })
    .map(([name]) => name);
}

/**
 * 获取非图像/视频类型的特征名（轻量数据，可一次性加载）
 */
export function getLightFeatureNames(info: LeRobotInfo | null): string[] {
  if (!info?.features) return [];

  return Object.entries(info.features)
    .filter(([, feat]) => !isImageFeature(feat) && !isVideoFeature(feat))
    .map(([name]) => name);
}

export type VisualFeatureSide = 'left' | 'center' | 'right';

export interface VisualFeatureClassification {
  side: VisualFeatureSide;
  isDepth: boolean;
}

function isLeftFeatureKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('left') ||
    lower.startsWith('l_') ||
    /[_./]l[_./]/.test(lower) ||
    /[_./]l$/.test(lower)
  );
}

function isRightFeatureKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('right') ||
    lower.startsWith('r_') ||
    /[_./]r[_./]/.test(lower) ||
    /[_./]r$/.test(lower)
  );
}

function sideRank(side: VisualFeatureSide): number {
  if (side === 'left') return 0;
  if (side === 'center') return 1;
  return 2;
}

/**
 * 基于 feature key 的语义分类（左右/深度）
 */
export function classifyVisualFeatureKey(key: string): VisualFeatureClassification {
  const lower = key.toLowerCase();
  const isDepth = lower.includes('depth');
  const side: VisualFeatureSide = isLeftFeatureKey(key)
    ? 'left'
    : isRightFeatureKey(key)
      ? 'right'
      : 'center';

  return { side, isDepth };
}

/** 视觉特征数 ≥ 此值时使用语义分桶布局（否则保留 RGB/深度 两行逻辑） */
const SEMANTIC_LAYOUT_MIN_KEYS = 4;

/**
 * 有序语义桶：id 越小越靠前显示（通常场景/头部先于末端/手腕）。
 * 匹配在去掉 depth token 后的后缀上进行，避免把 depth 单独成行。
 */
const SEMANTIC_BUCKET_RULES: ReadonlyArray<{ id: number; re: RegExp }> = [
  { id: 0, re: /\b(head|eye|scene|ego|high|main)\b/i },
  { id: 10, re: /\b(overhead|top)\b/i },
  { id: 20, re: /\b(wrist|hand|gripper|grasp)\b/i },
];

const SEMANTIC_BUCKET_FALLBACK = 100;

function visualFeatureSuffix(key: string): string {
  const seg = key.split('.').pop();
  return seg ?? key;
}

function normalizeSuffixForSemanticBucket(key: string): string {
  const suffix = visualFeatureSuffix(key).toLowerCase();
  return suffix
    .replace(/\bdepth\b/g, ' ')
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/**
 * 推断特征 key 的语义桶 id（用于 ≥4 路相机的分行）；数字越小越靠前。
 */
export function inferSemanticBucketId(key: string): number {
  const normalized = normalizeSuffixForSemanticBucket(key);
  for (const rule of SEMANTIC_BUCKET_RULES) {
    if (rule.re.test(normalized)) return rule.id;
  }
  return SEMANTIC_BUCKET_FALLBACK;
}

function compareVisualKeys(a: string, b: string): number {
  const ca = classifyVisualFeatureKey(a);
  const cb = classifyVisualFeatureKey(b);
  if (ca.isDepth !== cb.isDepth) return ca.isDepth ? 1 : -1;
  if (ca.side !== cb.side) return sideRank(ca.side) - sideRank(cb.side);
  return a.localeCompare(b);
}

/** 语义桶内：先 left→center→right，同侧再 non-depth→depth（便于 head 行呈 左/中深/右） */
function compareVisualKeysSemanticBucket(a: string, b: string): number {
  const ca = classifyVisualFeatureKey(a);
  const cb = classifyVisualFeatureKey(b);
  if (ca.side !== cb.side) return sideRank(ca.side) - sideRank(cb.side);
  if (ca.isDepth !== cb.isDepth) return ca.isDepth ? 1 : -1;
  return a.localeCompare(b);
}

function trimRowsToCapacity(
  row1: string[],
  row2: string[],
  capacity: number,
  maxPerRow: number,
): void {
  while (row1.length + row2.length > capacity) {
    if (row2.length > 0) {
      row2.pop();
    } else {
      row1.pop();
    }
  }
  if (row1.length === 0 && row2.length > 0) {
    row1.push(...row2.splice(0, Math.min(maxPerRow, row2.length)));
  }
}

/**
 * 语义分桶：按桶顺序装行，优先整桶换行，单桶超过 maxPerRow 时顺序切开。
 */
function getSemanticLayoutVisualRows(
  keys: string[],
  maxVisual: number,
  maxPerRow: number,
): { row1: string[]; row2: string[] } {
  const normalized = Array.from(new Set(keys));
  const buckets = new Map<number, string[]>();
  for (const key of normalized) {
    const bid = inferSemanticBucketId(key);
    const arr = buckets.get(bid);
    if (arr) arr.push(key);
    else buckets.set(bid, [key]);
  }
  for (const arr of buckets.values()) {
    arr.sort(compareVisualKeysSemanticBucket);
  }

  const row1: string[] = [];
  const row2: string[] = [];
  let cur = row1;
  const sortedIds = [...buckets.keys()].sort((a, b) => a - b);
  const capacity = Math.min(maxVisual, maxPerRow * 2);

  for (const bid of sortedIds) {
    let bucketKeys = buckets.get(bid)!;
    bucketKeys = [...bucketKeys].sort(compareVisualKeysSemanticBucket);
    while (bucketKeys.length > 0) {
      const space = maxPerRow - cur.length;
      if (space <= 0) {
        if (cur === row1) {
          cur = row2;
          continue;
        }
        break;
      }
      if (bucketKeys.length <= space) {
        cur.push(...bucketKeys);
        bucketKeys = [];
        continue;
      }
      if (bucketKeys.length <= maxPerRow && cur === row1 && row2.length === 0) {
        cur = row2;
        continue;
      }
      const take = Math.min(space, bucketKeys.length);
      cur.push(...bucketKeys.slice(0, take));
      bucketKeys = bucketKeys.slice(take);
      if (cur === row1) cur = row2;
      else break;
    }
  }

  trimRowsToCapacity(row1, row2, capacity, maxPerRow);
  return { row1, row2 };
}

function getLegacyLayoutVisualRows(
  keys: string[],
  maxVisual: number,
  maxPerRow: number,
): { row1: string[]; row2: string[] } {
  const normalized = Array.from(new Set(keys));
  const sorted = normalized.slice().sort(compareVisualKeys);

  const nonDepth = sorted.filter((k) => !classifyVisualFeatureKey(k).isDepth);
  const depth = sorted.filter((k) => classifyVisualFeatureKey(k).isDepth);
  const capacity = Math.min(maxVisual, maxPerRow * 2);

  const row1: string[] = nonDepth.slice(0, maxPerRow);
  const row2: string[] = depth.slice(0, maxPerRow);

  while (row1.length + row2.length > capacity) {
    if (row2.length > 0) {
      row2.pop();
    } else {
      row1.pop();
    }
  }

  const assigned = new Set([...row1, ...row2]);
  if (row1.length + row2.length < capacity) {
    for (const key of sorted) {
      if (assigned.has(key)) continue;
      if (row1.length + row2.length >= capacity) break;

      if (row1.length < maxPerRow) {
        row1.push(key);
        assigned.add(key);
        continue;
      }
      if (row2.length < maxPerRow) {
        row2.push(key);
        assigned.add(key);
      }
    }
  }

  trimRowsToCapacity(row1, row2, capacity, maxPerRow);
  return { row1, row2 };
}

/**
 * 自动布局视觉特征：
 * - 最多 maxVisual 路
 * - 每行最多 maxPerRow 路
 * - 路数 ≥ 4：按名称语义分桶分行（场景/头部 vs 末端等），桶内仍为非深度优先、left→center→right
 * - 路数少于 4：优先 non-depth 上行、depth 下行（旧行为）
 */
/** Narrow main panes cannot fit 4 Dockview tiles (100px min each) without clipping. */
export const NARROW_VISUAL_ROW_WIDTH = 900;

export function getVisualMaxPerRow(containerWidth: number): number {
  return containerWidth > 0 && containerWidth < NARROW_VISUAL_ROW_WIDTH ? 2 : 4;
}

export function getAutoLayoutVisualRows(
  keys: string[],
  maxVisual = 6,
  maxPerRow = 4,
): { row1: string[]; row2: string[] } {
  const normalized = Array.from(new Set(keys));
  if (normalized.length >= SEMANTIC_LAYOUT_MIN_KEYS) {
    return getSemanticLayoutVisualRows(keys, maxVisual, maxPerRow);
  }
  return getLegacyLayoutVisualRows(keys, maxVisual, maxPerRow);
}
