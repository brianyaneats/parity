import * as React from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/**
 * EmptyState — icon-free by design: §6.4 says exactly one sentence and one
 * action, and §0.5 bans decoration that doesn't carry information. An icon
 * here would be exactly that: decoration, not data.
 */
export interface EmptyStateProps {
  /** One sentence. Not a headline + subhead — a single sentence. */
  readonly message: string;
  readonly action?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  readonly className?: string;
}

export function EmptyState({ message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-1 px-6 py-10 text-center',
        className,
      )}
    >
      <p className="max-w-sm text-sm text-text-secondary">{message}</p>
      {action ? (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
