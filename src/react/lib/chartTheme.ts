/**
 * Resolve CSS design tokens for uPlot/canvas.
 * shadcn Base UI tokens are full CSS colors (oklch/hsl/rgb).
 */

/** Prefer the themed studio root (`.lerobot-root[.dark]`); `#lerobot-root` is only the mount host. */
const LEROOT =
  typeof document !== 'undefined'
    ? () =>
        (document.querySelector('.lerobot-root') as HTMLElement | null) ??
        (document.getElementById('lerobot-root') as HTMLElement | null)
    : () => null;

export function getCssVarColor(
  root: HTMLElement | null,
  varName: string,
  fallback = '#888',
): string {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(varName).trim();
  if (!v) return fallback;
  if (
    v.startsWith('oklch') ||
    v.startsWith('oklab') ||
    v.startsWith('hsl') ||
    v.startsWith('rgb') ||
    v.startsWith('color') ||
    v.startsWith('#')
  ) {
    return v;
  }
  // Legacy space-separated HSL components: "H S% L%"
  const hsl = v.includes(',') ? v : v.replace(/\s+/g, ', ');
  return `hsl(${hsl})`;
}

/** @deprecated Use getCssVarColor */
export function getCssVarHsl(root: HTMLElement | null, varName: string, fallback = '#888'): string {
  return getCssVarColor(root, varName, fallback);
}

export function getAxisColors(root: HTMLElement | null): {
  axisStroke: string;
  gridStroke: string;
  tickStroke: string;
} {
  return {
    axisStroke: getCssVarColor(root, '--muted-foreground', '#6b7280'),
    gridStroke: getCssVarColor(root, '--border', '#e5e7eb'),
    tickStroke: getCssVarColor(root, '--border', '#d1d5db'),
  };
}

const CHART_VAR_KEYS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--primary',
] as const;

/** Palette of 14 colors from design tokens (--chart-1..5, --primary, then repeat). */
export function getChartPalette(root: HTMLElement | null): string[] {
  const out: string[] = [];
  const fallbacks = ['#2563eb', '#dc2626', '#059669', '#ca8a04', '#7c3aed', '#0d9488'];
  for (let i = 0; i < 14; i++) {
    const key = CHART_VAR_KEYS[i % CHART_VAR_KEYS.length];
    out.push(getCssVarColor(root, key!, fallbacks[i % fallbacks.length]));
  }
  return out;
}

export function getLerobotRoot(): HTMLElement | null {
  return LEROOT();
}
