import { useEffect } from 'react';

/** Marks a container whose `[data-focus-item]` children are one roving list (segment list, track). */
export const FOCUS_GROUP_ATTRIBUTE = 'data-focus-group';
/** Marks an item of the nearest `[data-focus-group]`. */
export const FOCUS_ITEM_ATTRIBUTE = 'data-focus-item';

/** The items of `group`, in order, that belong to it (not to a nested group). */
export function focusItems(group: Element): HTMLElement[] {
  return Array.from(group.querySelectorAll<HTMLElement>(`[${FOCUS_ITEM_ATTRIBUTE}]`)).filter(
    (item) => item.parentElement?.closest(`[${FOCUS_GROUP_ATTRIBUTE}]`) === group,
  );
}

export type FocusedPlace = {
  element: HTMLElement;
  /** The roving list the element is an item of, if any. */
  group: Element | null;
  /** Its position in that list when it was last seen there. */
  index: number;
};

export function focusedPlace(element: HTMLElement): FocusedPlace {
  const item = element.closest<HTMLElement>(`[${FOCUS_ITEM_ATTRIBUTE}]`);
  const group = item?.parentElement?.closest(`[${FOCUS_GROUP_ATTRIBUTE}]`) ?? null;
  return { element, group, index: group && item ? focusItems(group).indexOf(item) : -1 };
}

/** True when focus can no longer stay on `element`: it left the document or was disabled. */
export function isFocusLost(element: HTMLElement): boolean {
  return !element.isConnected || element.matches(':disabled');
}

/**
 * Where focus goes when the element that had it is gone: the item now at its
 * place in the same list (the next one), else the list's last item (the
 * previous one), else the viewer root.
 */
export function recoveryTarget(place: FocusedPlace, root: HTMLElement): HTMLElement {
  const { group, index } = place;
  if (group && group.isConnected && root.contains(group) && index >= 0) {
    const items = focusItems(group).filter((item) => !isFocusLost(item));
    const target = items[Math.min(index, items.length - 1)];
    if (target) return target;
  }
  return root;
}

/**
 * One rule for every path that removes or disables the focused element inside
 * the viewer (a delete by key or button, a merge, an undo, a host removing a
 * segment): focus moves to the next item of the same list, else the previous
 * one, else the viewer root. Without it focus falls to `<body>`, outside the
 * viewer, and its keys stop working until the person clicks back in.
 *
 * Focus a person moves elsewhere on purpose (outside the viewer, or onto the
 * page) is never taken back: only a lost element triggers the rule.
 */
export function useFocusRecovery(root: HTMLElement | null): void {
  useEffect(() => {
    if (!root) return;
    let last: FocusedPlace | null = null;

    const recover = () => {
      if (!last || !isFocusLost(last.element)) return;
      const place = last;
      last = null;
      const active = document.activeElement;
      // Focus already went somewhere real (a dialog returning it, a click): leave it.
      const detached = !active || active === document.body || active === document.documentElement;
      if (!detached && active !== place.element) return;
      recoveryTarget(place, root).focus({ preventScroll: true });
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      last = target instanceof HTMLElement && target !== root ? focusedPlace(target) : null;
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget) return; // onFocusIn records the next place
      // Removal can blur before the mutation is observed: decide once the DOM settles.
      queueMicrotask(() => {
        if (!last || last.element !== event.target) return;
        if (isFocusLost(last.element)) recover();
        else if (document.activeElement !== last.element) last = null; // moved away on purpose
      });
    };
    const observer = new MutationObserver(() => {
      if (!last) return;
      if (isFocusLost(last.element)) recover();
      // Still focused: keep its place current (items before it may have moved).
      else if (document.activeElement === last.element) last = focusedPlace(last.element);
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      observer.disconnect();
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
    };
  }, [root]);
}
