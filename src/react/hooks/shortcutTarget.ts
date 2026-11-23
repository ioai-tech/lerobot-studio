/** True when focus landed on the document after a modal unmounted (body/html). */
export function isDetachedFocusTarget(target: EventTarget | null): boolean {
  if (typeof document === 'undefined' || target == null) return false;
  return target === document || target === document.body || target === document.documentElement;
}

/**
 * True when a key was pressed on the page itself (focus on `<body>`), not in a
 * page that is being edited (`contenteditable` body, `designMode`).
 */
export function isPageKeyTarget(target: EventTarget | null): boolean {
  if (!isDetachedFocusTarget(target)) return false;
  return document.designMode !== 'on' && !document.body?.isContentEditable;
}

/**
 * Widgets whose own keyboard model uses Space and the arrow keys (WAI-ARIA
 * composite roles). While one has focus, playback shortcuts stay out of its way.
 */
const KEY_OWNING_ROLES = new Set([
  'textbox',
  'combobox',
  'searchbox',
  'tab',
  'tablist',
  'slider',
  'spinbutton',
  'radio',
  'radiogroup',
  'checkbox',
  'switch',
  'listbox',
  'option',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tree',
  'treeitem',
  'grid',
  'gridcell',
  'separator',
]);

type ElementLike = {
  nodeType: number;
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
};

/** Realm-safe element check: a host may render the viewer into another window. */
function asElement(target: EventTarget | null): ElementLike | null {
  const node = target as Partial<ElementLike> | null;
  if (!node || node.nodeType !== 1 || typeof node.tagName !== 'string') return null;
  if (typeof node.getAttribute !== 'function' || typeof node.closest !== 'function') return null;
  return node as ElementLike;
}

/** Elements that Space activates natively (a click on key release). */
const SPACE_ACTIVATED_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);
const SPACE_ACTIVATED_ROLES = new Set(['button', 'link']);

/**
 * True when playback shortcuts must not consume the key: typing, a widget that
 * owns Space and the arrows, a modal, or Space on a focused button or link
 * (Space activates the control, as everywhere else on the platform; the
 * arrows still step playback there).
 *
 * @param key `KeyboardEvent.key`; omit to check only the target.
 */
export function isPlaybackShortcutBlocked(target: EventTarget | null, key?: string): boolean {
  if (isDetachedFocusTarget(target)) return false;
  const el = asElement(target);
  if (!el) return true;
  if (el.isContentEditable) return true;

  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  const role = el.getAttribute('role');
  if (role && KEY_OWNING_ROLES.has(role)) return true;
  if (
    key === ' ' &&
    (SPACE_ACTIVATED_TAGS.has(tag) || (role !== null && SPACE_ACTIVATED_ROLES.has(role)))
  ) {
    return true;
  }

  return Boolean(el.closest('[data-slot="dialog-content"], [role="dialog"], [role="alertdialog"]'));
}
