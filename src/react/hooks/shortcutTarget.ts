/** True when focus landed on the document after a modal unmounted (body/html). */
export function isDetachedFocusTarget(target: EventTarget | null): boolean {
  if (typeof document === 'undefined' || target == null) return false;
  return target === document || target === document.body || target === document.documentElement;
}

/** True when playback shortcuts must not consume the key (typing or a modal). */
export function isPlaybackShortcutBlocked(target: EventTarget | null): boolean {
  if (isDetachedFocusTarget(target)) return false;
  if (!(target instanceof HTMLElement)) return true;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  const role = target.getAttribute('role');
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;

  return Boolean(
    target.closest('[data-slot="dialog-content"], [role="dialog"], [role="alertdialog"]'),
  );
}

/** True when the event belongs to this Studio instance (or focus was left on the document). */
export function isEventInsideStudio(
  target: EventTarget | null,
  portal: HTMLElement | null,
): boolean {
  if (!portal) return true;
  if (isDetachedFocusTarget(target)) return true;
  return target instanceof Node && portal.contains(target);
}
