import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCssVarColor, getChartPalette, resolveCssColorToRgb } from '@/lib/chartTheme';

describe('chartTheme canvas-safe color resolution', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.className = 'lerobot-root';
    root.style.setProperty('--chart-1', 'oklch(0.61 0.2 255)');
    root.style.setProperty('--chart-2', '#dc2626');
    root.style.setProperty('--primary', 'var(--mui-palette-primary-main, #1976d2)');
    root.style.setProperty('--mui-palette-primary-main', '#1976d2');
    root.style.setProperty('--border', 'var(--mui-palette-divider, #e0e0e0)');
    root.style.setProperty('--mui-palette-divider', '#e0e0e0');
    root.style.setProperty('--muted-foreground', '#64748b');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    document.querySelectorAll('[data-lerobot-color-probe-wrap]').forEach((el) => el.remove());
    document.querySelectorAll('[data-lerobot-color-probe]').forEach((el) => el.remove());
  });

  it('resolves oklch tokens to rgb()', () => {
    const color = getCssVarColor(root, '--chart-1', '#2563eb');
    expect(color).toMatch(/^rgba?\(/);
    expect(color).not.toContain('oklch');
    // Chromatic blue-ish token should not collapse to black.
    expect(color).not.toBe('rgb(0, 0, 0)');
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });

  it('resolves hex tokens to rgb()', () => {
    const color = getCssVarColor(root, '--chart-2', '#000000');
    expect(color).toMatch(/^rgba?\(/);
    expect(color).toContain('220'); // #dc2626 red channel
  });

  it('resolves nested var(--mui-...) tokens to rgb()', () => {
    const primary = getCssVarColor(root, '--primary', '#000000');
    const border = getCssVarColor(root, '--border', '#000000');
    expect(primary).toMatch(/^rgba?\(/);
    expect(border).toMatch(/^rgba?\(/);
    expect(primary).not.toContain('var(');
    expect(border).not.toContain('hsl(');
    expect(primary).not.toBe('rgb(0, 0, 0)');
  });

  it('falls back when the custom property is missing', () => {
    expect(getCssVarColor(root, '--chart-missing', '#059669')).toBe('#059669');
    expect(resolveCssColorToRgb('', root, '#ca8a04')).toBe('#ca8a04');
  });

  it('builds a palette of canvas-safe rgb colors', () => {
    const palette = getChartPalette(root);
    expect(palette).toHaveLength(14);
    for (const color of palette) {
      expect(color.startsWith('rgb') || color.startsWith('#')).toBe(true);
      expect(color).not.toContain('oklch');
      expect(color).not.toContain('var(');
    }
    // First entries should be distinct chromatic colors, not all black.
    expect(new Set(palette.slice(0, 5)).size).toBeGreaterThan(1);
  });
});
