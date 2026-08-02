'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { FOCUS_WITHIN_RING } from './_shared';

/**
 * Input — §6.4 required states: default, focus, error, disabled,
 * with-prefix, with-suffix.
 *
 * `label` is required, not optional, on purpose: §6.7 bans placeholder-as-
 * label, and the only way to make that mistake impossible for every consumer
 * is to not let them render this component without a real `<label>`. Use
 * `hideLabel` for a visually-hidden-but-present label rather than omitting
 * one.
 */
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly prefix?: React.ReactNode;
  readonly suffix?: React.ReactNode;
  readonly containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hideLabel,
    error,
    hint,
    prefix,
    suffix,
    id,
    className,
    containerClassName,
    disabled,
    required,
    ...props
  },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <label
        htmlFor={inputId}
        className={cn('text-xs font-medium text-text-secondary', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-status-critical">
            {' '}
            *
          </span>
        ) : null}
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
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-9 w-full flex-1 bg-transparent text-sm text-text-primary outline-none',
            'placeholder:text-text-muted disabled:cursor-not-allowed',
            className,
          )}
          {...props}
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
});
