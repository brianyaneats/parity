'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FOCUS_RING } from './_shared';

/**
 * Disclosure — an inline expand/collapse. §0.5 bans "any modal that could
 * have been an inline expansion," so this is the default primitive for
 * progressive detail throughout the app (the assumptions panel in §7.3, the
 * chart-behind-a-table-view in §6.5 rule 7, etc.).
 *
 * No height animation — §6.6 doesn't allow transitioning `height`, and the
 * classic "grid-rows 0fr→1fr" workaround is exactly the kind of
 * layout-triggering transition the rule exists to rule out. The chevron
 * rotation (`transform`) is the only motion here.
 */
export interface DisclosureProps {
  readonly summary: React.ReactNode;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
}: DisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const contentId = React.useId();

  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={cn('rounded-md border border-border bg-surface-1', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-text-primary',
          FOCUS_RING,
        )}
      >
        {summary}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-text-muted',
            'transition-transform duration-fast ease-standard',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <div id={contentId} className="border-t border-border px-3 py-3 text-sm text-text-secondary">
          {children}
        </div>
      ) : null}
    </div>
  );
}
