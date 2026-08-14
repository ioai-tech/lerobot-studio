import { describe, expect, it } from 'vitest';
import { classifyVisualFeatureKey, getAutoLayoutVisualRows, getVisualMaxPerRow } from '@/core';

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

  it('uses 2 cameras per row on a narrow pane and 4 on a wide pane', () => {
    expect(getVisualMaxPerRow(800)).toBe(2);
    expect(getVisualMaxPerRow(900)).toBe(4);
    expect(getVisualMaxPerRow(1280)).toBe(4);
  });
});
