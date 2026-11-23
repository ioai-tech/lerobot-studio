import type { LeRobotFeature } from '../types/lerobot';
import { getFeatureInfoValue } from '../utils/mediaFeatureMetadata';

/**
 * Camera-first layout. Cameras get the height first: their row takes what
 * the tiles need to show the whole frame, at least `CAMERA_SHARE` of the
 * panel area, and the charts below keep at least `CHART_MIN_HEIGHT_PX` — but
 * in a short panel area never more than the rest of the cameras' share
 * (s10 F-31: at 1024 × 768 with the segment inspector open, the fixed chart
 * floor left the cameras an 80 px strip).
 */
export const CAMERA_SHARE = 0.62;
export const CHART_MIN_HEIGHT_PX = 200;
/** Height of a panel's title bar above its content. */
export const PANEL_HEADER_PX = 28;
const DEFAULT_ASPECT = 4 / 3;

/** Width / height of a camera feature, from its video metadata or the `[h, w, c]` shape. */
export function visualAspectRatio(feature: LeRobotFeature | undefined): number {
  const width = Number(getFeatureInfoValue(feature, 'video.width'));
  const height = Number(getFeatureInfoValue(feature, 'video.height'));
  if (width > 0 && height > 0) return width / height;
  const shape = feature?.shape;
  const names = feature?.names as unknown;
  if (Array.isArray(shape) && shape.length >= 2) {
    const nameList = Array.isArray(names) ? names.map(String) : [];
    const hIndex = nameList.indexOf('height');
    const wIndex = nameList.indexOf('width');
    const h = Number(shape[hIndex >= 0 ? hIndex : 0]);
    const w = Number(shape[wIndex >= 0 ? wIndex : 1]);
    if (w > 0 && h > 0) return w / h;
  }
  return DEFAULT_ASPECT;
}

/** Height of the camera area: what the tiles need, at least the camera share, leaving the charts their minimum. */
export function cameraAreaHeight(input: {
  /** Panel area height (cameras + charts). */
  height: number;
  /** Panel area width. */
  width: number;
  /** Rows of cameras (1 or 2). */
  rows: number;
  /** Cameras in the widest row. */
  perRow: number;
  aspect: number;
}): number {
  const { height, width, rows, perRow, aspect } = input;
  if (!(height > 0) || !(width > 0) || rows <= 0 || perRow <= 0) return Math.max(0, height);
  const tileWidth = width / perRow;
  const needed = rows * (tileWidth / Math.max(0.1, aspect) + PANEL_HEADER_PX);
  const target = Math.max(needed, height * CAMERA_SHARE);
  const chartFloor = Math.min(CHART_MIN_HEIGHT_PX, height * (1 - CAMERA_SHARE));
  return Math.round(Math.max(0, Math.min(target, height - chartFloor)));
}

/**
 * Cameras per row that shows the biggest frames in the camera area (one or
 * two rows). Ties keep one row.
 */
export function chooseCamerasPerRow(input: {
  count: number;
  width: number;
  height: number;
  aspect: number;
  /** Most cameras a row may hold. */
  maxPerRow?: number;
}): number {
  const { count, width, height, aspect } = input;
  const maxPerRow = Math.max(1, input.maxPerRow ?? 4);
  if (count <= 1 || !(width > 0) || !(height > 0)) return Math.min(Math.max(1, count), maxPerRow);
  const budget = height * CAMERA_SHARE;
  let best = { perRow: Math.min(count, maxPerRow), area: -1 };
  for (const rows of [1, 2]) {
    const perRow = Math.ceil(count / rows);
    if (perRow > maxPerRow) continue;
    const tileWidth = width / perRow;
    const tileHeight = budget / rows - PANEL_HEADER_PX;
    if (tileHeight <= 0) continue;
    const shownWidth = Math.min(tileWidth, tileHeight * aspect);
    const area = shownWidth * (shownWidth / aspect);
    if (area > best.area * 1.0001) best = { perRow, area };
  }
  return best.perRow;
}
