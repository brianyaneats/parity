import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * GlassPanel — states: flat, hover-raised. The translucent counterpart to
 * `Card`: `--glass` background plus the inset highlight shadow (`shadow-
 * glass`) that gives it a hairline top edge, per §6.2's glass-surface tokens.
 */
export interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly hoverRaised?: boolean;
}

export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(function GlassPanel(
  { className, hoverRaised = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-glass p-4 shadow-glass',
        hoverRaised && 'hover:border-border-strong hover:bg-glass-hover hover:shadow-e2',
        className,
      )}
      {...props}
    />
  );
});
