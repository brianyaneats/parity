import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Card — states: flat, hover-raised.
 *
 * "Hover-raised" swaps `shadow-e1` for `shadow-e2` and lifts the border to
 * `border-strong` on `:hover`, with no transition on the shadow itself
 * (box-shadow isn't on §6.6's allowed-transition list) — the swap is
 * instant, which reads as a crisp state change rather than a soft glow.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly hoverRaised?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, hoverRaised = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-surface-1 p-4 shadow-e1',
        hoverRaised && 'hover:border-border-strong hover:shadow-e2',
        className,
      )}
      {...props}
    />
  );
});
