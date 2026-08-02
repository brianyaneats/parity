'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';

/**
 * Tooltip — Radix's Trigger already listens for `focus`/`blur` as well as
 * pointer events, so wrapping a focusable element here satisfies §6.5 rule 9
 * / §6.7's "must also open on keyboard focus, not just hover" without extra
 * wiring. `children` must be a single focusable element (a button, a link,
 * an icon-only control with its own accessible name) — the tooltip is
 * supplementary, never the only source of that name.
 */
export interface TooltipProps {
  readonly content: React.ReactNode;
  readonly children: React.ReactElement;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly delayDurationMs?: number;
}

export function Tooltip({ content, children, side = 'top', delayDurationMs = 200 }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDurationMs}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              'z-50 max-w-xs rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary shadow-e2',
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-surface-2" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
