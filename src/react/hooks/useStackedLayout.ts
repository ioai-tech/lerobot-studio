import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** Container width (px) below which the episode sidebar stacks under the player. */
export const STACKED_LAYOUT_MAX_WIDTH_PX = 640;

export function isStackedLayoutWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width < STACKED_LAYOUT_MAX_WIDTH_PX;
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * True while the observed container is narrower than 640px. Measured in a
 * layout effect so the first paint already uses the right layout, then kept in
 * sync with a ResizeObserver (disconnected on unmount).
 */
export function useStackedLayout(ref: RefObject<HTMLElement | null>): boolean {
  return useNarrowerThan(ref, STACKED_LAYOUT_MAX_WIDTH_PX);
}

/** Container width (px) below which segment editing is replaced by one line asking for room. */
export const EDITING_MIN_WIDTH_PX = 768;

/**
 * True while the observed container is narrower than `px` (and measured).
 * First measured in a layout effect, then kept in sync with a ResizeObserver.
 */
export function useNarrowerThan(ref: RefObject<HTMLElement | null>, px: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const below = (width: number) => Number.isFinite(width) && width > 0 && width < px;
    setNarrow(below(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setNarrow(below(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, px]);
  return narrow;
}
