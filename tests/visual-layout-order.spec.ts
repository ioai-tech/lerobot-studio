import { describe, expect, it } from 'vitest';
import {
  classifyVisualFeatureKey,
  cameraAreaHeight,
  chooseCamerasPerRow,
  getAutoLayoutVisualRows,
  isStackedPanelsWidth,
  visualAspectRatio,
  CAMERA_SHARE,
  CHART_MIN_HEIGHT_PX,
  PANEL_HEADER_PX,
} from '@/core';

describe('visual auto layout', () => {
  it('with >=4 keys, groups by semantic bucket (head vs wrist) then packs rows', () => {
    const keys = [
      'observation.images.cam_high',
      'observation.images.cam_left_wrist',
      'observation.images.cam_right_wrist_depth',
      'observation.images.cam_high_depth',
      'observation.images.cam_right_wrist',
      'observation.images.cam_left_wrist_depth',
    ];

    const rows = getAutoLayoutVisualRows(keys, 6, 4);

    expect(rows.row1).toEqual(['observation.images.cam_high', 'observation.images.cam_high_depth']);
    expect(rows.row2).toEqual([
      'observation.images.cam_left_wrist',
      'observation.images.cam_left_wrist_depth',
      'observation.images.cam_right_wrist',
      'observation.images.cam_right_wrist_depth',
    ]);
  });

  it('with <4 keys, keeps legacy rgb row then depth row', () => {
    const keys = [
      'observation.images.cam_high',
      'observation.images.cam_left_wrist',
      'observation.images.cam_high_depth',
    ];

    const rows = getAutoLayoutVisualRows(keys, 6, 4);

    expect(rows.row1).toEqual(['observation.images.cam_left_wrist', 'observation.images.cam_high']);
    expect(rows.row2).toEqual(['observation.images.cam_high_depth']);
  });

  it('keeps at most six visual features and each row at most four', () => {
    const keys = [
      'observation.images.cam_left',
      'observation.images.cam_high',
      'observation.images.cam_right',
      'observation.images.cam_front',
      'observation.images.cam_left_depth',
      'observation.images.cam_high_depth',
      'observation.images.cam_right_depth',
      'observation.images.cam_front_depth',
    ];

    const rows = getAutoLayoutVisualRows(keys, 6, 4);
    const all = [...rows.row1, ...rows.row2];

    expect(all.length).toBe(6);
    expect(rows.row1.length).toBeLessThanOrEqual(4);
    expect(rows.row2.length).toBeLessThanOrEqual(4);
  });

  it('with >=4 keys without wrist tokens, places scene bucket first then other keys', () => {
    const keys = [
      'observation.images.cam_left_1',
      'observation.images.cam_left_2',
      'observation.images.cam_high',
      'observation.images.cam_right_1',
      'observation.images.cam_right_2',
    ];

    const rows = getAutoLayoutVisualRows(keys, 6, 4);

    expect(rows.row1).toEqual(['observation.images.cam_high']);
    expect(rows.row2).toEqual([
      'observation.images.cam_left_1',
      'observation.images.cam_left_2',
      'observation.images.cam_right_1',
      'observation.images.cam_right_2',
    ]);
  });

  it('places head row including depth_head and wrist+gripper row (user-style naming)', () => {
    const keys = [
      'observation.images.camera_head_left',
      'observation.images.camera_depth_head',
      'observation.images.camera_head_right',
      'observation.images.camera_left_wrist',
      'observation.images.camera_gripper',
      'observation.images.camera_right_wrist',
    ];

    const rows = getAutoLayoutVisualRows(keys, 6, 4);

    expect(rows.row1).toEqual([
      'observation.images.camera_head_left',
      'observation.images.camera_depth_head',
      'observation.images.camera_head_right',
    ]);
    expect(rows.row2).toEqual([
      'observation.images.camera_left_wrist',
      'observation.images.camera_gripper',
      'observation.images.camera_right_wrist',
    ]);
  });

  it('classifies side and depth from feature key', () => {
    expect(classifyVisualFeatureKey('observation.images.cam_left_wrist_depth')).toEqual({
      side: 'left',
      isDepth: true,
    });
    expect(classifyVisualFeatureKey('observation.images.cam_high')).toEqual({
      side: 'center',
      isDepth: false,
    });
    expect(classifyVisualFeatureKey('observation.images.cam_right_wrist')).toEqual({
      side: 'right',
      isDepth: false,
    });
  });

  it('orders unknown center names between left and right', () => {
    const keys = [
      'observation.images.cam_left_eye',
      'observation.images.main_any_name',
      'observation.images.cam_right_eye',
    ];

    const rows = getAutoLayoutVisualRows(keys, 6, 4);

    expect(rows.row1).toEqual([
      'observation.images.cam_left_eye',
      'observation.images.main_any_name',
      'observation.images.cam_right_eye',
    ]);
  });

  it('keeps 3 or 4 cameras in one row while that shows bigger frames, two rows for 6', () => {
    const aspect = 4 / 3;
    // 1024x768 with the sidebar open: three cameras side by side, not 2 + 1.
    expect(chooseCamerasPerRow({ count: 3, width: 768, height: 470, aspect })).toBe(3);
    expect(chooseCamerasPerRow({ count: 3, width: 1184, height: 644, aspect })).toBe(3);
    expect(chooseCamerasPerRow({ count: 4, width: 1184, height: 644, aspect })).toBe(4);
    expect(chooseCamerasPerRow({ count: 6, width: 1184, height: 644, aspect, maxPerRow: 4 })).toBe(
      3,
    );
    // A tall, narrow pane stacks two rows.
    expect(chooseCamerasPerRow({ count: 2, width: 500, height: 1400, aspect })).toBe(1);
    expect(chooseCamerasPerRow({ count: 1, width: 500, height: 400, aspect })).toBe(1);
  });

  it('gives cameras the height first and leaves the charts their minimum', () => {
    // 3 cameras at 1440x900 with the sidebar open: >= 360 px of camera content.
    const top = cameraAreaHeight({ height: 644, width: 1184, rows: 1, perRow: 3, aspect: 4 / 3 });
    expect(top - PANEL_HEADER_PX).toBeGreaterThanOrEqual(360);
    expect(644 - top).toBeGreaterThanOrEqual(CHART_MIN_HEIGHT_PX);
    // Tall frames ask for more than the share, up to the chart minimum.
    const tall = cameraAreaHeight({ height: 700, width: 1200, rows: 1, perRow: 2, aspect: 9 / 16 });
    expect(tall).toBe(700 - CHART_MIN_HEIGHT_PX);
  });

  it('a short panel area keeps the cameras their share; the chart floor gives way (s10 F-31)', () => {
    // 1024 × 768 with the segment inspector open leaves the panels about 300 px.
    for (const height of [240, 300, 400]) {
      const cameras = cameraAreaHeight({ height, width: 696, rows: 1, perRow: 4, aspect: 4 / 3 });
      expect(cameras, `height ${height}`).toBeGreaterThanOrEqual(Math.floor(height * CAMERA_SHARE));
      expect(height - cameras, `height ${height}`).toBeGreaterThan(0);
    }
    // Tall enough, the charts keep their full floor as before.
    const roomy = cameraAreaHeight({
      height: 900,
      width: 1200,
      rows: 1,
      perRow: 2,
      aspect: 9 / 16,
    });
    expect(roomy).toBe(900 - CHART_MIN_HEIGHT_PX);
  });

  it('reads the frame aspect from video info, then from the named shape', () => {
    expect(
      visualAspectRatio({
        dtype: 'video',
        shape: [480, 640, 3],
        names: ['height', 'width', 'channels'],
      } as never),
    ).toBeCloseTo(4 / 3);
    expect(
      visualAspectRatio({
        dtype: 'video',
        shape: [3, 720, 1280],
        names: ['channels', 'height', 'width'],
        info: { 'video.width': 1280, 'video.height': 720 },
      } as never),
    ).toBeCloseTo(16 / 9);
    expect(visualAspectRatio(undefined)).toBeCloseTo(4 / 3);
  });

  it('never leaves a camera out while the rows have room (s10 F-09: ALOHA cam_low)', () => {
    const aloha = [
      'observation.images.cam_high',
      'observation.images.cam_left_wrist',
      'observation.images.cam_low',
      'observation.images.cam_right_wrist',
    ];
    for (const perRow of [2, 3, 4]) {
      const rows = getAutoLayoutVisualRows(aloha, 6, perRow);
      expect([...rows.row1, ...rows.row2].sort(), `perRow ${perRow}`).toEqual([...aloha].sort());
      expect(rows.row1.length).toBeLessThanOrEqual(perRow);
      expect(rows.row2.length).toBeLessThanOrEqual(perRow);
    }
    // Two per row: the scene cameras share the first row, the wrists the second.
    expect(getAutoLayoutVisualRows(aloha, 6, 2)).toEqual({
      row1: ['observation.images.cam_high', 'observation.images.cam_low'],
      row2: ['observation.images.cam_left_wrist', 'observation.images.cam_right_wrist'],
    });
    // Up to the capacity (two rows), every camera of any naming is shown.
    const many = ['top', 'front', 'side', 'left_wrist', 'right_wrist', 'gripper'].map(
      (name) => `observation.images.${name}`,
    );
    const rows = getAutoLayoutVisualRows(many, 6, 3);
    expect([...rows.row1, ...rows.row2].sort()).toEqual([...many].sort());
  });

  it('stacks panels into one column under 600px of container width', () => {
    expect(isStackedPanelsWidth(390)).toBe(true);
    expect(isStackedPanelsWidth(599)).toBe(true);
    expect(isStackedPanelsWidth(600)).toBe(false);
    expect(isStackedPanelsWidth(1280)).toBe(false);
    expect(isStackedPanelsWidth(0)).toBe(false);
  });
});
