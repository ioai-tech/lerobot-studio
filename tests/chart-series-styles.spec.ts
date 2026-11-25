import { describe, expect, it } from 'vitest';
import {
  ACTION_DASH,
  buildSeriesStyles,
  collectChartDimensions,
  WRAPPED_STATE_DASH,
} from '../src/react/components/panels/ChartPanel/chartPanelModel';

const pose = { dtype: 'float32', shape: [3], names: ['x', 'y', 'z'] };
const palette = Array.from({ length: 14 }, (_, i) => `c${i}`);

describe('chart series styles', () => {
  it('pairs an action with the state of the same joint: one color, action dashed', () => {
    const dims = collectChartDimensions(['action', 'observation.state'], {
      action: { dtype: 'float32', shape: [2], names: ['shoulder', 'elbow'] },
      'observation.state': { dtype: 'float32', shape: [2], names: ['shoulder', 'elbow'] },
    } as never);
    const styles = buildSeriesStyles(dims, [], palette, '#000');
    expect(styles.get('action::0')!.color).toBe(styles.get('observation.state::0')!.color);
    expect(styles.get('action::0')!.color).not.toBe(styles.get('action::1')!.color);
    expect(styles.get('action::0')!.dash).toEqual(ACTION_DASH);
    expect(styles.get('observation.state::0')!.dash).toBeUndefined();
  });

  it('gives features that reuse names (three poses of x, y, z) their own colors', () => {
    const keys = ['observation.pose.head', 'observation.pose.left', 'observation.pose.right'];
    const dims = collectChartDimensions(
      keys,
      Object.fromEntries(keys.map((key) => [key, pose])) as never,
    );
    const styles = buildSeriesStyles(dims, [], palette, '#000');
    const colors = dims.map((dim) => styles.get(dim.id)!.color);
    expect(new Set(colors).size).toBe(9);
  });

  it('dots state series once the palette wraps; auxiliary series come after the features', () => {
    const dims = collectChartDimensions(['observation.state'], {
      'observation.state': {
        dtype: 'float32',
        shape: [16],
        names: Array.from({ length: 16 }, (_, i) => `j${i}`),
      },
    } as never);
    const styles = buildSeriesStyles(dims, ['aux:imu:acc::0'], palette, '#000');
    const dashed = dims.filter((dim) => styles.get(dim.id)!.dash === WRAPPED_STATE_DASH);
    expect(dashed).toHaveLength(2);
    // 16 feature colors are taken: the auxiliary series is the 17th slot.
    expect(styles.get('aux:imu:acc::0')).toEqual({ color: 'c2', dash: WRAPPED_STATE_DASH });
  });
});
