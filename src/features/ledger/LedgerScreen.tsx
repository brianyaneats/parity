'use client';

import { useMemo, useState } from 'react';
import { StatTile } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/format';
import {
  buildCumulativeSeries,
  buildSourceBreakdown,
  sumProjectedCents,
  sumRealizedCents,
} from './ledger-aggregate';
import { CumulativeChart } from './CumulativeChart';
import { BySourceList } from './BySourceList';
import { EventsTable } from './EventsTable';
import type { LedgerEventView } from './ledger-types';

/**
 * `/ledger` — §7.7.
 *
 * Two views over the same underlying events: Cumulative (a two-series area
 * chart, realized vs projected over time) and By source (a ranked bar list
 * across the six `savings_events.kind` values, §13.3). Below both, the raw
 * event feed is always visible — §7.7 says every event must be drillable and
 * exportable regardless of which chart the user happens to be looking at.
 *
 * §8.6's headline rule governs the two stat tiles: only the realized figure
 * is the hero; projected is a second, plainly-labelled tile, never netted
 * into the same number. Conflating them is called out in §8.6 as a direct
 * failure of §1.5's auditability success criterion.
 */

type LedgerView = 'cumulative' | 'bySource';

export function LedgerScreen({ events }: { events: readonly LedgerEventView[] }) {
  const [view, setView] = useState<LedgerView>('cumulative');

  const cumulative = useMemo(() => buildCumulativeSeries(events), [events]);
  const bySource = useMemo(() => buildSourceBreakdown(events), [events]);
  const realizedTotal = useMemo(() => sumRealizedCents(events), [events]);
  const projectedTotal = useMemo(() => sumProjectedCents(events), [events]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 lg:p-6">
      <header>
        <h1 className="text-h1 text-text-primary">Savings ledger</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Every dollar Parity has found, split by whether it has actually landed.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          hero
          label="Realized to date"
          value={formatCents(realizedTotal)}
          sublabel="Claims approved, credits burned, bookings made"
        />
        <StatTile
          label="Projected"
          value={formatCents(projectedTotal)}
          sublabel="What saved comparisons say you should capture — not yet realized"
        />
      </div>

      <ViewToggle view={view} onChange={setView} />

      {view === 'cumulative' ? (
        <CumulativeChart points={cumulative} />
      ) : (
        <BySourceList rows={bySource} />
      )}

      <EventsTable events={events} />
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: LedgerView;
  onChange: (view: LedgerView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Ledger view"
      className="flex w-fit gap-1 rounded-md border border-border bg-surface-1 p-1"
    >
      <ToggleButton active={view === 'cumulative'} onClick={() => onChange('cumulative')}>
        Cumulative
      </ToggleButton>
      <ToggleButton active={view === 'bySource'} onClick={() => onChange('bySource')}>
        By source
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-sm px-3 py-1.5 text-sm font-medium transition-opacity duration-fast ease-standard outline-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
        active ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
