'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { FOCUS_RING, PRESS_TRANSITION } from './_shared';

/**
 * Button — §6.4 required states: default, hover, active, focus-visible,
 * disabled, loading.
 *
 * Colour swaps (hover backgrounds, etc.) happen instantly, with no
 * `transition-colors` class anywhere — §6.6 permits transitions only on
 * `opacity`/`transform`/`width`. The only animated things here are the
 * press-scale feedback (`transform`) and the loading spinner (`transform`
 * via `animate-spin`).
 */
const buttonVariants = cva(
  cn(
    // Pill shape + semibold label: the measured system's interactive
    // signature (buttons, search, chips all round fully).
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill',
    'text-sm font-semibold disabled:pointer-events-none disabled:opacity-50',
    PRESS_TRANSITION,
    'active:scale-[0.98]',
    FOCUS_RING,
  ),
  {
    variants: {
      variant: {
        primary: 'bg-accent-lime text-accent-lime-ink hover:opacity-90',
        secondary: 'border border-border bg-surface-2 text-text-primary hover:bg-surface-1',
        ghost: 'bg-transparent text-text-primary hover:bg-glass-hover',
        destructive: 'bg-status-critical text-status-ink hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-4 text-xs',
        md: 'h-10 px-5 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner and keeps the button's accessible name while it loads.
   * Implies `disabled` — a loading button can't be activated twice. */
  readonly loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, children, type, ...props },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
