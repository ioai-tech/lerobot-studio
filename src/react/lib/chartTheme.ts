/**
 * Resolve CSS design tokens for uPlot/canvas.
 * Always return canvas-safe `rgb()` / `rgba()` colors — never raw `oklch()` or
 * unresolved `var()` strings (those become black or opaque-wrong on canvas).
 */

/** Prefer the themed studio root (`.lerobot-root[.dark]`); `#lerobot-root` is only the mount host. */
const LEROOT =
  typeof document !== 'undefined'
    ? () =>
        (document.querySelector('.lerobot-root') as HTMLElement | null) ??
        (document.getElementById('lerobot-root') as HTMLElement | null)
    : () => null;

const SENTINEL = 'rgb(1, 2, 3)';

let probeWrap: HTMLElement | null = null;
let probeEl: HTMLElement | null = null;
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function getProbePair(): { wrap: HTMLElement; probe: HTMLElement } | null {
  if (typeof document === 'undefined') return null;
  if (probeWrap?.isConnected && probeEl?.isConnected) {
    return { wrap: probeWrap, probe: probeEl };
  }
  probeWrap = document.createElement('span');
  probeWrap.setAttribute('data-lerobot-color-probe-wrap', '');
  probeWrap.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;visibility:hidden';
  probeEl = document.createElement('span');
  probeEl.setAttribute('data-lerobot-color-probe', '');
  probeWrap.appendChild(probeEl);
  document.documentElement.appendChild(probeWrap);
  return { wrap: probeWrap, probe: probeEl };
}

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (measureCtx) return measureCtx;
  measureCanvas = document.createElement('canvas');
  measureCanvas.width = 1;
  measureCanvas.height = 1;
  measureCtx = measureCanvas.getContext('2d', { willReadFrequently: true });
  return measureCtx;
}

/** Convert any paint-able CSS color (including oklch) to rgb()/rgba() via pixel readback. */
function canvasColorToRgb(colorValue: string, fallback: string): string {
  const ctx = getMeasureContext();
  if (!ctx) return fallback;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000000';
  ctx.fillStyle = colorValue;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return fallback;
  if (a === 255) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
}

/**
 * Force the browser to resolve any CSS color (oklch, var(), hsl, …) to rgb()/rgba().
 * Wrapper carries a sentinel so invalid-at-computed-value colors inherit the
 * sentinel instead of document black.
 */
export function resolveCssColorToRgb(
  colorValue: string,
  root: HTMLElement | null,
  fallback: string,
): string {
  if (!colorValue.trim()) return fallback;
  const pair = getProbePair();
  if (!pair) return fallback;
  const { wrap, probe } = pair;

  const parent = root && root.isConnected ? root : document.documentElement;
  if (wrap.parentElement !== parent) {
    parent.appendChild(wrap);
  }

  wrap.style.color = SENTINEL;
  probe.style.color = colorValue;
  const computed = getComputedStyle(probe).color.trim();
  probe.style.color = '';
  wrap.style.color = '';

  if (
    !computed ||
    computed === SENTINEL ||
    computed === 'rgba(0, 0, 0, 0)' ||
    computed === 'transparent'
  ) {
    return fallback;
  }

  // Modern Chromium may serialize color as oklch(); canvas stroke accepts it in
  // some engines but withAlpha / older hosts need rgb(). Always normalize.
  return canvasColorToRgb(computed, fallback);
}

export function getCssVarColor(
  root: HTMLElement | null,
  varName: string,
  fallback = '#888',
): string {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return fallback;

  // Read the specified custom-property value first. Missing tokens return "" so
  // we can fall back without inheriting host black via invalid `var(--missing)`.
  const specified = getComputedStyle(el).getPropertyValue(varName).trim();
  if (!specified) return fallback;

  return resolveCssColorToRgb(specified, el, fallback);
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
