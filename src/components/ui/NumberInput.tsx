'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { FOCUS_WITHIN_RING } from './_shared';

/**
 * NumberInput — §6.4 required states: default, focus, error, disabled,
 * with-prefix, with-suffix. Supports integer or decimal entry with
 * `min`/`max`/`step`.
 *
 * Rendered as `type="text" inputMode="…"` rather than `type="number"` so we
 * control parsing and clamping ourselves instead of relying on the browser's
 * (inconsistent, locale-dependent) number input behavior. The value is
 * clamped to `min`/`max` and rounded to an integer (when `integer`) on blur,
 * not on every keystroke, so the user can type "-" or "12." mid-edit without
 * fighting the field.
 */
export interface NumberInputProps {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly integer?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly prefix?: React.ReactNode;
  readonly suffix?: React.ReactNode;
  readonly id?: string;
  readonly name?: string;
  readonly hideLabel?: boolean;
  readonly className?: string;
  readonly containerClassName?: string;
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let result = value;
  if (min !== undefined && result < min) result = min;
  if (max !== undefined && result > max) result = max;
  return result;
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      label,
      value,
      onChange,
      min,
      max,
      step,
      integer = false,
      error,
      hint,
      disabled,
      required,
      placeholder,
      prefix,
      suffix,
      id,
      name,
      hideLabel,
      className,
      containerClassName,
    },
    ref,
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

    const [raw, setRaw] = React.useState(value === null ? '' : String(value));
    const [focused, setFocused] = React.useState(false);

    React.useEffect(() => {
      if (!focused) setRaw(value === null ? '' : String(value));
    }, [value, focused]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setRaw(next);
      if (next.trim() === '') {
        onChange(null);
        return;
      }
      if (!/^-?\d*\.?\d*$/.test(next)) return;
      const parsed = integer ? Number.parseInt(next, 10) : Number.parseFloat(next);
      if (Number.isNaN(parsed)) return;
      onChange(parsed);
    };

    const handleFocus = () => setFocused(true);

    const handleBlur = () => {
      setFocused(false);
      if (value === null) {
        setRaw('');
        return;
      }
      const clamped = clamp(integer ? Math.round(value) : value, min, max);
      if (clamped !== value) onChange(clamped);
      setRaw(String(clamped));
    };

    return (
      <div className={cn('flex flex-col gap-1', containerClassName)}>
        <label
          htmlFor={inputId}
          className={cn('text-xs font-medium text-text-secondary', hideLabel && 'sr-only')}
        >
          {label}
        </label>
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3',
            FOCUS_WITHIN_RING,
            error && 'border-status-critical',
            disabled && 'opacity-50',
          )}
        >
          {prefix ? (
            <span className="shrink-0 text-sm text-text-muted" aria-hidden="true">
              {prefix}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            name={name}
            type="text"
            inputMode={integer ? 'numeric' : 'decimal'}
            value={raw}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            data-step={step}
            className={cn(
              'tnum h-9 w-full flex-1 bg-transparent text-sm text-text-primary outline-none',
              'placeholder:text-text-muted disabled:cursor-not-allowed',
              className,
            )}
          />
          {suffix ? (
            <span className="shrink-0 text-sm text-text-muted" aria-hidden="true">
              {suffix}
            </span>
          ) : null}
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-status-critical">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
