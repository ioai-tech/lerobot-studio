import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/ui';

export interface TimeFieldProps {
  label: string;
  /** Formatted time of the stored value. */
  value: string;
  disabled?: boolean;
  /** Parse and apply; return an error text to keep the typed value marked, or null when applied. */
  onCommit: (text: string) => string | null;
}

/**
 * A masked `m:ss.cc` time input: selects everything on focus, applies on
 * Enter or blur, reverts on Escape, and keeps a refused value visible and
 * marked with the reason.
 */
export const TimeField: React.FC<TimeFieldProps> = ({ label, value, disabled, onCommit }) => {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setText(value);
      setError(null);
    }
  }, [value]);

  const commit = () => {
    editingRef.current = false;
    if (text.trim() === value) {
      setText(value);
      setError(null);
      return;
    }
    const failure = onCommit(text);
    setError(failure);
    if (failure) editingRef.current = true;
  };

  return (
    <span className="inline-flex flex-col">
      <label className="inline-flex items-center gap-1 text-xs text-muted-foreground" htmlFor={id}>
        {label}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'h-7 w-[5.5rem] rounded-md border border-input bg-transparent px-1.5 font-mono text-xs text-foreground tabular-nums',
            'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
            'disabled:opacity-60',
            error && 'border-destructive ring-1 ring-destructive/40',
          )}
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            editingRef.current = true;
            setText(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              editingRef.current = false;
              setText(value);
              setError(null);
            }
          }}
          placeholder={t('segments.inspector.timePlaceholder')}
        />
      </label>
      {error ? (
        <span id={`${id}-error`} role="alert" className="max-w-56 text-[11px] text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
};
