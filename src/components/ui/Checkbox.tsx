'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FOCUS_RING } from './_shared';

/**
 * Checkbox — §6.4 required states: default (unchecked), checked,
 * indeterminate, focus-visible, disabled.
 *
 * `checked` accepts `'indeterminate'` directly (Radix's own `CheckedState`
 * shape), so a caller doing tri-state "select all" bookkeeping doesn't need
 * a second boolean prop. Clicking an indeterminate checkbox always resolves
 * to `true` — Radix never fires `onCheckedChange('indeterminate')` from a
 * user interaction, only from a prop you set programmatically — so the
 * public `onCheckedChange` here is a plain boolean callback.
 */
export interface CheckboxProps {
  readonly label: string;
  readonly checked: boolean | 'indeterminate';
  readonly onCheckedChange: (checked: boolean) => void;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly value?: string;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { label, checked, onCheckedChange, description, disabled, hideLabel, id, name, value },
  ref,
) {
  const generatedId = React.useId();
  const checkboxId = id ?? generatedId;
  const descriptionId = description ? `${checkboxId}-description` : undefined;

  return (
    <div className="flex items-start gap-2">
      <CheckboxPrimitive.Root
        ref={ref}
        id={checkboxId}
        name={name}
        value={value}
        checked={checked}
        onCheckedChange={(state) => onCheckedChange(state === true)}
        disabled={disabled}
        aria-describedby={descriptionId}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface-1',
          'data-[state=checked]:border-accent-lime data-[state=checked]:bg-accent-lime',
          'data-[state=indeterminate]:border-accent-lime data-[state=indeterminate]:bg-accent-lime',
          'disabled:cursor-not-allowed disabled:opacity-50',
          FOCUS_RING,
        )}
      >
        <CheckboxPrimitive.Indicator className="text-accent-lime-ink">
          {checked === 'indeterminate' ? (
            <Minus className="size-3" aria-hidden="true" />
          ) : (
            <Check className="size-3" aria-hidden="true" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div className="flex flex-col gap-0.5">
        <label
          htmlFor={checkboxId}
          className={cn('text-sm font-medium text-text-primary', hideLabel && 'sr-only')}
        >
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-xs text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
});
