/**
 * Shared tooltip / hover legend positioning for uPlot charts.
 * uPlot recommends reading u.cursor.left/top (relative to u.over) and mapping into
 * the chart container; try multiple placements and clamp to edges (see demos/cursor-tooltip.html).
 */

export const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export type TooltipPlacement = 'right-bottom' | 'left-bottom' | 'right-top' | 'left-top';

export type TooltipPlacementState = {
  placement: TooltipPlacement;
  left: number;
  top: number;
};

export const computeTooltipPlacement = ({
  cursorX,
  cursorY,
  tooltipW,
  tooltipH,
  containerW,
  containerH,
  edgePadding,
  cursorGapX,
  cursorGapY,
  cursorDx,
  cursorDy,
  previousPlacement,
  switchTolerancePx,
  keepPreviousOnStable,
}: {
  cursorX: number;
  cursorY: number;
  tooltipW: number;
  tooltipH: number;
  containerW: number;
  containerH: number;
  edgePadding: number;
  cursorGapX: number;
  cursorGapY: number;
  cursorDx: number;
  cursorDy: number;
  previousPlacement: TooltipPlacement | null;
  switchTolerancePx: number;
  keepPreviousOnStable: boolean;
}): TooltipPlacementState => {
  const movementDeadZone = 1.5;
  const movingHorizontally = Math.abs(cursorDx) > movementDeadZone;
  const movingVertically = Math.abs(cursorDy) > movementDeadZone;

  const preferredH = movingHorizontally ? (cursorDx > 0 ? 'left' : 'right') : 'right';
  const fallbackH = preferredH === 'right' ? 'left' : 'right';
  const preferredV = movingVertically ? (cursorDy > 0 ? 'top' : 'bottom') : 'bottom';
  const fallbackV = preferredV === 'bottom' ? 'top' : 'bottom';

  const toPlacement = (h: 'left' | 'right', v: 'top' | 'bottom'): TooltipPlacement =>
    `${h}-${v}` as TooltipPlacement;

  const candidates: TooltipPlacement[] = [
    toPlacement(preferredH, preferredV),
    toPlacement(fallbackH, preferredV),
    toPlacement(preferredH, fallbackV),
    toPlacement(fallbackH, fallbackV),
  ];
  const maxLeft = Math.max(edgePadding, containerW - tooltipW - edgePadding);
  const maxTop = Math.max(edgePadding, containerH - tooltipH - edgePadding);

  const evaluate = (placement: TooltipPlacement) => {
    const left =
      placement === 'right-bottom' || placement === 'right-top'
        ? cursorX + cursorGapX
        : cursorX - tooltipW - cursorGapX;
    const top =
      placement === 'right-bottom' || placement === 'left-bottom'
        ? cursorY + cursorGapY
        : cursorY - tooltipH - cursorGapY;

    const overflowLeft = Math.max(0, edgePadding - left);
    const overflowRight = Math.max(0, left + tooltipW - (containerW - edgePadding));
    const overflowTop = Math.max(0, edgePadding - top);
    const overflowBottom = Math.max(0, top + tooltipH - (containerH - edgePadding));
    const overflow = overflowLeft + overflowRight + overflowTop + overflowBottom;
    const fits = overflow === 0;

    return { placement, left, top, overflow, fits };
  };

  const evaluated = candidates.map(evaluate);
  const bestFit = evaluated.find((item) => item.fits);
  const minOverflow = evaluated.reduce(
    (best, item) => (item.overflow < best.overflow ? item : best),
    evaluated[0]!,
  );
  let selected = bestFit ?? minOverflow;

  if (previousPlacement) {
    const prev = evaluated.find((item) => item.placement === previousPlacement);
    if (prev) {
      if (keepPreviousOnStable && prev.fits && selected.fits) {
        selected = prev;
      } else if (
        !prev.fits &&
        !selected.fits &&
        prev.overflow <= selected.overflow + switchTolerancePx
      ) {
        selected = prev;
      }
    }
  }

  return {
    placement: selected.placement,
    left: clamp(selected.left, edgePadding, maxLeft),
    top: clamp(selected.top, edgePadding, maxTop),
  };
};
