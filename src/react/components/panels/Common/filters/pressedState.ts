/** A filter row button's pressed state (`aria-pressed`): the selection its `TriStateBox` draws. */
export function pressedState(checked: boolean, indeterminate: boolean): boolean | 'mixed' {
  return indeterminate ? 'mixed' : checked;
}
