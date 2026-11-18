/**
 * The segment key table: one list drives the key handler, the shortcut sheet
 * and the key hints on buttons. Matching uses `KeyboardEvent.code` where the
 * printed character depends on the layout (brackets, comma, period).
 */

export type SegmentShortcutId =
  | 'confirm'
  | 'confirmAll'
  | 'delete'
  | 'split'
  | 'merge'
  | 'setIn'
  | 'setOut'
  | 'nudgeBack'
  | 'nudgeForward'
  | 'nudgeBackSecond'
  | 'nudgeForwardSecond'
  | 'new'
  | 'nextUncovered'
  | 'next'
  | 'previous'
  | 'loop'
  | 'subtaskStart'
  | 'subtaskEnd'
  | 'undo'
  | 'redo'
  | 'help';

export interface SegmentShortcut {
  id: SegmentShortcutId;
  /** Key caps shown to people. */
  keys: string[];
  /** Changes data: only offered when editing is allowed. */
  edit: boolean;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

export const SEGMENT_SHORTCUTS: readonly SegmentShortcut[] = [
  { id: 'confirm', keys: ['A'], edit: true },
  { id: 'confirmAll', keys: ['Shift+A'], edit: true },
  { id: 'delete', keys: ['R', 'Delete'], edit: true },
  { id: 'split', keys: ['S'], edit: true },
  { id: 'merge', keys: ['M'], edit: true },
  { id: 'setIn', keys: ['['], edit: true },
  { id: 'setOut', keys: [']'], edit: true },
  { id: 'nudgeBack', keys: [','], edit: true },
  { id: 'nudgeForward', keys: ['.'], edit: true },
  { id: 'nudgeBackSecond', keys: ['Alt+,'], edit: true },
  { id: 'nudgeForwardSecond', keys: ['Alt+.'], edit: true },
  { id: 'new', keys: ['N'], edit: true },
  { id: 'nextUncovered', keys: ['G'], edit: false },
  { id: 'next', keys: ['J'], edit: false },
  { id: 'previous', keys: ['K'], edit: false },
  { id: 'loop', keys: ['L'], edit: false },
  { id: 'subtaskStart', keys: ['Shift+['], edit: true },
  { id: 'subtaskEnd', keys: ['Shift+]'], edit: true },
  { id: 'undo', keys: ['Ctrl/⌘+Z'], edit: true },
  { id: 'redo', keys: ['Shift+Ctrl/⌘+Z'], edit: true },
  { id: 'help', keys: ['?'], edit: false },
];

export function shortcutKeys(id: SegmentShortcutId): string {
  return SEGMENT_SHORTCUTS.find((item) => item.id === id)?.keys.join(' / ') ?? '';
}

function letter(event: KeyLike): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  return event.key.length === 1 ? event.key.toUpperCase() : null;
}

/** The segment action a key event asks for, if any. `Ctrl/Cmd+K` is never bound. */
export function matchSegmentShortcut(event: KeyLike): SegmentShortcutId | null {
  const mod = event.ctrlKey || event.metaKey;
  const name = letter(event);
  if (mod) {
    if (event.altKey || name !== 'Z') return null;
    return event.shiftKey ? 'redo' : 'undo';
  }
  if (event.key === '?') return 'help';
  if (event.code === 'BracketLeft' || event.key === '[' || event.key === '{') {
    return event.shiftKey ? 'subtaskStart' : 'setIn';
  }
  if (event.code === 'BracketRight' || event.key === ']' || event.key === '}') {
    return event.shiftKey ? 'subtaskEnd' : 'setOut';
  }
  if (event.code === 'Comma' || event.key === ',') {
    return event.altKey ? 'nudgeBackSecond' : event.shiftKey ? null : 'nudgeBack';
  }
  if (event.code === 'Period' || event.key === '.') {
    return event.altKey ? 'nudgeForwardSecond' : event.shiftKey ? null : 'nudgeForward';
  }
  if (event.key === 'Delete') return 'delete';
  if (event.altKey) return null;
  switch (name) {
    case 'A':
      return event.shiftKey ? 'confirmAll' : 'confirm';
    case 'R':
      return event.shiftKey ? null : 'delete';
    case 'S':
      return event.shiftKey ? null : 'split';
    case 'M':
      return event.shiftKey ? null : 'merge';
    case 'N':
      return event.shiftKey ? null : 'new';
    case 'G':
      return event.shiftKey ? null : 'nextUncovered';
    case 'J':
      return event.shiftKey ? null : 'next';
    case 'K':
      return event.shiftKey ? null : 'previous';
    case 'L':
      return event.shiftKey ? null : 'loop';
    default:
      return null;
  }
}

/** A select-field option key (`1`–`9`), without modifiers. */
export function matchFieldOptionKey(event: KeyLike): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? /^Numpad([1-9])$/.exec(event.code)?.[1];
  if (digit) return digit;
  return /^[1-9]$/.test(event.key) ? event.key : null;
}

type ElementLike = {
  nodeType: number;
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
};

const TEXT_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);

/**
 * Segment keys need focus inside the viewer root and never act while a person
 * types (input, textarea, select, editable text) or a dialog is open.
 */
export function isSegmentShortcutTarget(
  target: EventTarget | null,
  root: { contains(node: unknown): boolean } | null,
): boolean {
  const node = target as Partial<ElementLike> | null;
  if (!root || !node || node.nodeType !== 1 || typeof node.tagName !== 'string') return false;
  if (!root.contains(node)) return false;
  const el = node as ElementLike;
  if (el.isContentEditable) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  const role = el.getAttribute('role');
  if (role && TEXT_ROLES.has(role)) return false;
  return !el.closest('[data-slot="dialog-content"], [role="dialog"], [role="alertdialog"]');
}
