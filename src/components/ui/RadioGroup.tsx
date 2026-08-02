'use client';

import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/cn';
import { FOCUS_RING } from './_shared';

/**
 * RadioGroup — states: default, selected, focus-visible, disabled (per item
 * or for the whole group).
 *
 * Wrapped in a native `<fieldset>`/`<legend>` rather than an
 * `aria-labelledby` pairing — it is the more direct, more broadly supported
 * way to give a group of radios an accessible group name (§6.7: every form
 * input labeled).
 */
export interface RadioOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface RadioGroupProps {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  readonly options: readonly RadioOption[];
  readonly hideLabel?: boolean;
  readonly name?: string;
  readonly disabled?: boolean;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly className?: string;
}

export function RadioGroup({
  label,
  value,
  onChange,
  options,
  hideLabel,
  name,
  disabled,
  orientation = 'vertical',
  className,
}: RadioGroupProps) {
  const groupId = React.useId();

  return (
    <fieldset className={cn('flex flex-col gap-2 border-0 p-0 m-0', className)}>
      <legend className={cn('text-xs font-medium text-text-secondary', hideLabel && 'sr-only')}>
        {label}
      </legend>
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        name={name}
        className={cn('flex gap-3', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}
      >
        {options.map((option) => {
          const itemId = `${groupId}-${option.value}`;
          const descriptionId = option.description ? `${itemId}-description` : undefined;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupPrimitive.Item
                id={itemId}
                value={option.value}
                disabled={option.disabled}
                aria-describedby={descriptionId}
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-surface-1',
                  'data-[state=checked]:border-accent-lime',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  FOCUS_RING,
                )}
              >
                <RadioGroupPrimitive.Indicator asChild>
                  <span className="size-2 rounded-pill bg-accent-lime" />
                </RadioGroupPrimitive.Indicator>
              </RadioGroupPrimitive.Item>
              <div className="flex flex-col gap-0.5">
                <label htmlFor={itemId} className="text-sm font-medium text-text-primary">
                  {option.label}
                </label>
                {option.description ? (
                  <p id={descriptionId} className="text-xs text-text-muted">
                    {option.description}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </RadioGroupPrimitive.Root>
    </fieldset>
  );
}
