import * as React from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Skeleton } from './Skeleton';

/**
 * StatTile — value, label, sublabel, optional delta, loading. §6.4 also
 * calls for "one optional `hero` variant using `text-display` for the single
 * hero figure per screen" — that variant only changes the value's type
 * scale. The value stays `text-primary` in both variants: `--accent-lime`
 * is fill-only in light mode (tokens.css), so colouring the figure lime
 * would pass contrast in dark mode and fail it in light — coloured accent
 * on the hero figure is deliberately not attempted here; size alone carries
 * the "this is the one number that matters" signal, which is what the spec
 * literally asks for.
 */
export interface StatTileDelta {
  readonly label: string;
  readonly direction: 'up' | 'down' | 'flat';
  readonly sentiment?: 'good' | 'bad' | 'neutral';
}

export interface StatTileProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly sublabel?: React.ReactNode;
  readonly delta?: StatTileDelta;
  readonly loading?: boolean;
  readonly hero?: boolean;
  readonly className?: string;
}

const DELTA_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

const DELTA_COLOR: Record<NonNullable<StatTileDelta['sentiment']>, string> = {
  good: 'text-status-good',
  bad: 'text-status-critical',
  neutral: 'text-text-muted',
};

export function StatTile({ label, value, sublabel, delta, loading = false, hero = false, className }: StatTileProps) {
  if (loading) {
    return (
      <div className={cn('flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4', className)}>
        <Skeleton className="h-3 w-20" />
        <Skeleton className={cn('w-32', hero ? 'h-9' : 'h-7')} />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }

  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null;
  const deltaSentiment = delta?.sentiment ?? 'neutral';

  return (
    <div className={cn('flex flex-col gap-1 rounded-lg border border-border bg-surface-1 p-4', className)}>
      <p className="text-label uppercase text-text-muted">{label}</p>
      <p className={cn('tnum text-text-primary', hero ? 'text-display' : 'text-h1')}>{value}</p>
      {sublabel ? <p className="text-xs text-text-muted">{sublabel}</p> : null}
      {delta ? (
        <p className={cn('mt-1 flex items-center gap-1 text-xs font-medium', DELTA_COLOR[deltaSentiment])}>
          {DeltaIcon ? <DeltaIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
          {delta.label}
        </p>
      ) : null}
    </div>
  );
}
