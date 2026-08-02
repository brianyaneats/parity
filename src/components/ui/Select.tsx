'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FOCUS_RING } from './_shared';

/**
 * Select — §6.4 required states: closed, open, loading, empty, no-results.
 *
 * Wraps Radix's Select so open/close and keyboard navigation come for free
 * and are correct by construction. `loading`/empty/no-results are rendered
 * inside the content based on props, since Radix Select has no built-in
 * concept of asynchronously-loaded options.
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly required?: boolean;
  readonly containerClassName?: string;
  readonly emptyMessage?: string;
}

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    label,
    value,
    onChange,
    options,
    placeholder = 'Select…',
    loading = false,
    disabled = false,
    error,
    hint,
    hideLabel,
    id,
    name,
    required,
    containerClassName,
    emptyMessage = 'No options available.',
  },
  ref,
) {
  const generatedId = React.useId();
  const triggerId = id ?? generatedId;
  const errorId = error ? `${triggerId}-error` : undefined;
  const hintId = hint ? `${triggerId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <label
        htmlFor={triggerId}
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
      <SelectPrimitive.Root
        value={value}
        onValueChange={onChange}
        disabled={disabled || loading}
        name={name}
      >
        <SelectPrimitive.Trigger
          ref={ref}
          id={triggerId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border',
            'bg-surface-1 px-3 text-sm text-text-primary data-[placeholder]:text-text-muted',
            'disabled:cursor-not-allowed disabled:opacity-50',
            FOCUS_RING,
            error && 'border-status-critical',
          )}
        >
          <span className="truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" aria-hidden="true" />
          ) : (
            <SelectPrimitive.Icon asChild>
              <ChevronDown className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
            </SelectPrimitive.Icon>
          )}
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-64 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface-2 text-text-primary shadow-e2"
          >
            <SelectPrimitive.Viewport className="p-1">
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-text-muted">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading options…
                </div>
              ) : options.length === 0 ? (
                <p className="px-2 py-3 text-sm text-text-muted">{emptyMessage}</p>
              ) : (
                options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm',
                      'data-[highlighted]:bg-glass-hover data-[highlighted]:outline-none',
                      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                    )}
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-4 text-text-primary" aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))
              )}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
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
