import type React from 'react';

/**
 * Arrow keys move between the radios of a `role="radiogroup"` and choose the
 * one they land on (WAI-ARIA radio group); Home / End go to the ends.
 */
export function onRadioGroupKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  const step =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
  if (!step && event.key !== 'Home' && event.key !== 'End') return;
  const radios = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  );
  if (radios.length === 0) return;
  const index = radios.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? radios.length - 1
        : (Math.max(index, 0) + step + radios.length) % radios.length;
  event.preventDefault();
  event.stopPropagation();
  radios[next].focus();
  if (radios[next].getAttribute('aria-checked') !== 'true') radios[next].click();
}

/** Roving tab stop: the checked radio, or the first when none is checked. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
