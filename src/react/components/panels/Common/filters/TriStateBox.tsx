import { Check, Minus } from 'lucide-react';
import { cn } from '@/ui';

/**
 * The tri-state box drawn inside a filter row button. The button owns the state
 * (`aria-pressed`, see `pressedState`); this is only its picture, so it is not a
 * form control: no interactive content nested in the button, nothing a host
 * `<form>` around the viewer could submit, nothing Chrome asks an id for.
 */
export function TriStateBox({
  checked,
  indeterminate,
}: {
  checked: boolean;
  indeterminate: boolean;
}) {
  const filled = checked || indeterminate;
  return (
    <span
      aria-hidden
      data-state={indeterminate ? 'indeterminate' : checked ? 'checked' : 'unchecked'}
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
        filled
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background',
      )}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </span>
  );
}
