import { useCallback, useEffect, useRef } from 'react';

/**
 * Which keys a viewer takes besides the ones pressed while focus is inside it:
 *
 * - `auto`: also the keys pressed while focus is on the page itself
 *   (`<body>`: right after the viewer opens, after a host navigation, or after
 *   a click on an area that takes no focus), when it is the viewer that
 *   opened or was used last among the shown viewers.
 * - `page`: the same, and it is preferred over `auto` viewers (the host's
 *   main view among several viewers on one page).
 * - `viewer`: only keys pressed while focus is inside it.
 *
 * Keys typed into a field, a focused control of the host page, or any shown
 * modal dialog never reach a viewer this way.
 */
export type LeRobotKeyboardScope = 'auto' | 'page' | 'viewer';

type PageKeysEntry = {
  root: HTMLElement | null;
  scope: LeRobotKeyboardScope;
  /** Logical time of the last open or use (focus or pointer inside the viewer). */
  usedAt: number;
};

/** Mounted viewers with keyboard shortcuts on (per realm; a module set, not a singleton viewer). */
const viewers = new Set<PageKeysEntry>();
let clock = 0;

function isShown(entry: PageKeysEntry): boolean {
  const root = entry.root;
  return Boolean(root && root.isConnected && root.getClientRects().length > 0);
}

/** True when `entry` is the one viewer that takes keys pressed on the page itself. */
export function ownsPageKeys(entry: PageKeysEntry): boolean {
  if (entry.scope === 'viewer' || !viewers.has(entry) || !isShown(entry)) return false;
  const shown = [...viewers].filter((item) => item.scope !== 'viewer' && isShown(item));
  const preferred = shown.filter((item) => item.scope === 'page');
  const pool = preferred.length > 0 ? preferred : shown;
  if (!pool.includes(entry)) return false;
  let latest = pool[0]!;
  for (const item of pool) if (item.usedAt > latest.usedAt) latest = item;
  return latest === entry;
}

/**
 * A modal dialog of the host page (or the viewer) is open: page keys belong to
 * it. A non-modal `<dialog>` (`show()`, or `open` set directly) leaves the page
 * usable, so it keeps only the keys pressed while focus is inside it (the
 * target check). Only a modal a person can see counts. Hosts keep closed modals mounted
 * (a keepMounted drawer, a dialog kept for its exit transition, a hidden
 * portal): they stay marked `aria-modal` but are hidden from people with
 * `aria-hidden` or `inert` on themselves or an ancestor, `display: none`
 * (`hidden`), or `visibility: hidden`. One open at a time is the norm, so the
 * check walks a handful of nodes per key.
 */
function modalOpen(doc: Document): boolean {
  for (const modal of doc.querySelectorAll('[aria-modal="true"], dialog:modal')) {
    if (modal.closest('[aria-hidden="true"], [inert]')) continue;
    if (modal.getClientRects().length === 0) continue;
    if (doc.defaultView?.getComputedStyle(modal).visibility !== 'visible') continue;
    return true;
  }
  return false;
}

/**
 * Registers a viewer root for page keys while `enabled`, and returns a stable
 * check: does this viewer take a key whose target is the page itself?
 */
export function usePageKeys(
  root: HTMLElement | null,
  scope: LeRobotKeyboardScope,
  enabled: boolean,
): () => boolean {
  const entryRef = useRef<PageKeysEntry | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const entry: PageKeysEntry = { root, scope, usedAt: ++clock };
    entryRef.current = entry;
    viewers.add(entry);
    const markUsed = () => {
      entry.usedAt = ++clock;
    };
    root?.addEventListener('pointerdown', markUsed, true);
    root?.addEventListener('focusin', markUsed, true);
    return () => {
      root?.removeEventListener('pointerdown', markUsed, true);
      root?.removeEventListener('focusin', markUsed, true);
      viewers.delete(entry);
      if (entryRef.current === entry) entryRef.current = null;
    };
  }, [enabled, root, scope]);

  return useCallback(() => {
    const entry = entryRef.current;
    if (!entry) return false;
    // Without a scoped root (the standalone app's shell) the page is the viewer.
    if (!entry.root) return entry.scope !== 'viewer';
    if (modalOpen(entry.root.ownerDocument)) return false;
    return ownsPageKeys(entry);
  }, []);
}
