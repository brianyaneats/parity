import * as React from 'react';
import { AlertTriangle, CheckCircle2, Trophy, XCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Badge — neutral / good / warning / critical, plus a `best` pill variant.
 *
 * §6.7: colour is never the sole carrier of meaning. Every status variant
 * renders an icon by default (overridable) alongside the text label — a
 * caller cannot accidentally ship a colour-only badge.
 */
const badgeVariants = cva(
  'inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-surface-2 text-text-secondary',
        good: 'border-border bg-surface-2 text-status-good',
        warning: 'border-border bg-surface-2 text-status-warning',
        critical: 'border-border bg-surface-2 text-status-critical',
        best: 'rounded-pill border-transparent bg-accent-lime text-accent-lime-ink',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

const DEFAULT_ICON: Record<NonNullable<VariantProps<typeof badgeVariants>['variant']>, React.ComponentType<{ className?: string }> | null> = {
  neutral: null,
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
  best: Trophy,
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Override the variant's default icon. Pass `false` only for `neutral`
   * badges — status variants always carry an icon so colour is never the
   * sole signal (§6.7). */
  readonly icon?: React.ComponentType<{ className?: string }> | false;
}

export function Badge({ className, variant = 'neutral', icon, children, ...props }: BadgeProps) {
  const Icon = icon === false ? null : icon ?? DEFAULT_ICON[variant ?? 'neutral'];
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
