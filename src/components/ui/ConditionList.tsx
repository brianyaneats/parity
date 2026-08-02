'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FOCUS_RING } from './_shared';

/**
 * ConditionList — §6.4: "pass / fail / warn rows, icon + label + text."
 *
 * A generic, reusable shape: this component knows nothing about price-match
 * conditions or evidence items specifically. `src/components/compare/
 * PriceMatchPanel.tsx` (out of scope for this deliverable) renders PM1–PM9 with
 * its own bespoke row because it needs a fourth "pending / user-attested"
 * state; the claim kit's ten-element evidence checklist (§7.4) is the
 * three-state case this component is built for and reuses it directly.
 *
 * Two shapes in one component:
 * - **Read-only** (no `onToggle`): a static `<li>`, for a condition list that
 *   is only ever reporting a computed state.
 * - **Tickable** (`onToggle` supplied): each row is a `role="checkbox"`
 *   button, because §7.4 describes the evidence checklist as rows "the user
 *   ticks as they capture" the evidence — a real toggle, not a status readout.
 *
 * §6.7: colour is never the sole carrier. Every row pairs its status colour
 * with an icon *and* a screen-reader-only status word alongside the visible
 * label, and `emphasized` rows (§7.4's two `highRisk` items) get a border
 * rather than relying on colour alone to stand out.
 */

export type ConditionState = 'pass' | 'fail' | 'warn';

export interface ConditionListItem {
  readonly id: string;
  readonly label: string;
  readonly state: ConditionState;
  /** The "why this matters / what happens if it's missing" line — §7.4 item 2. */
  readonly description?: string;
  /** Visual emphasis, independent of `state` — the two highest-risk items. */
  readonly emphasized?: boolean;
}

export interface ConditionListProps {
  readonly items: readonly ConditionListItem[];
  /** Present only when rows are tickable. Called with the row's `id`. */
  readonly onToggle?: (id: string) => void;
  readonly className?: string;
  readonly 'aria-label'?: string;
}

const STATE_CONFIG: Record<
  ConditionState,
  { readonly icon: React.ComponentType<{ className?: string }>; readonly word: string; readonly textClass: string }
> = {
  pass: { icon: CheckCircle2, word: 'Done', textClass: 'text-status-good' },
  fail: { icon: XCircle, word: 'Failed', textClass: 'text-status-critical' },
  warn: { icon: AlertTriangle, word: 'Needs attention', textClass: 'text-status-warning' },
};

export function ConditionList({ items, onToggle, className, 'aria-label': ariaLabel }: ConditionListProps) {
  return (
    <ul className={cn('flex flex-col gap-1.5', className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <ConditionRow key={item.id} item={item} onToggle={onToggle} />
      ))}
    </ul>
  );
}

function ConditionRow({
  item,
  onToggle,
}: {
  readonly item: ConditionListItem;
  readonly onToggle?: (id: string) => void;
}) {
  const { icon: Icon, word, textClass } = STATE_CONFIG[item.state];

  const rowClassName = cn(
    'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left',
    item.emphasized && 'border border-border-strong bg-glass',
  );

  const body = (
    <>
      <Icon className={cn('mt-0.5 size-4 shrink-0', textClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary">
          {item.label}
          <span className="sr-only"> — {word}</span>
        </p>
        {item.description ? <p className="mt-0.5 text-xs text-text-muted">{item.description}</p> : null}
      </div>
    </>
  );

  if (onToggle) {
    return (
      <li>
        <button
          type="button"
          role="checkbox"
          aria-checked={item.state === 'pass'}
          onClick={() => onToggle(item.id)}
          className={cn(rowClassName, 'hover:bg-glass-hover', FOCUS_RING)}
        >
          {body}
        </button>
      </li>
    );
  }

  return <li className={rowClassName}>{body}</li>;
}
