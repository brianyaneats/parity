'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';
import { FOCUS_RING, PRESS_TRANSITION } from './_shared';

/**
 * Toggle — a boolean on/off switch (Radix Switch). States: on, off,
 * focus-visible, disabled. The thumb's slide is a `transform: translateX`
 * change, which is on §6.6's allowed-transition list.
 */
export interface ToggleProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly name?: string;
}

export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { label, checked, onCheckedChange, description, disabled, hideLabel, id, name },
  ref,
) {
  const generatedId = React.useId();
  const switchId = id ?? generatedId;
  const descriptionId = description ? `${switchId}-description` : undefined;

  return (
    <div className="flex items-start gap-3">
      <SwitchPrimitive.Root
        ref={ref}
        id={switchId}
        name={name}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={descriptionId}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-pill border border-border-strong bg-surface-2',
          'data-[state=checked]:border-accent-lime data-[state=checked]:bg-accent-lime',
          'disabled:cursor-not-allowed disabled:opacity-50',
          FOCUS_RING,
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'block size-4 translate-x-0.5 rounded-pill bg-text-primary',
            'data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-lime-ink',
            PRESS_TRANSITION,
          )}
        />
      </SwitchPrimitive.Root>
      <div className="flex flex-col gap-0.5">
        <label
          htmlFor={switchId}
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
