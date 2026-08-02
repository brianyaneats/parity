'use client';

import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { ChannelBarList } from '@/components/compare/ChannelBar';
import { PriceMatchPanel } from '@/components/compare/PriceMatchPanel';
import {
  ClawbackGuard,
  Disclaimer,
  FhrAsymmetryNote,
  WarningList,
} from '@/components/compare/Insights';
import { rankResults } from '@/domain/engine/ranking';
import { formatCents, formatDate, formatNights } from '@/lib/format';
import type { ChannelResult, StayContext } from '@/domain/engine/types';

/**
 * A saved comparison — §4.3, §7.1.
 *
 * "**Never recompute a historical comparison with a newer engine and overwrite
 * it.** When the engine version changes, a saved comparison renders from its
 * snapshot with a subtle 'computed under engine v1.0.2' note and an explicit
 * 'recompute' button that creates a *new* row."
 *
 * §13.3 predicts this is what will be gotten wrong: "The instinct is to
 * recompute everything on read." So this component receives the stored results
 * and **never calls the engine**. The only thing it re-derives is the ranking,
 * which is a pure sort of the stored values — not a recalculation of them.
 *
 * This is what makes §1.5's audit criterion achievable: the numbers on screen
 * are the numbers that were computed at the time, not today's answer wearing
 * yesterday's date.
 */

export interface SavedComparisonProps {
  readonly id: string;
  readonly propertyName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly createdAt: string;
  readonly engineVersion: string;
  readonly currentEngineVersion: string;
  readonly context: StayContext;
  readonly results: readonly ChannelResult[];
  readonly chosenChannel: string | null;
  readonly recomputedFromId: string | null;
}

export function SavedComparison(props: SavedComparisonProps) {
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pure re-sort of stored values. No engine call, no arithmetic.
  const ranked = rankResults(props.results);
  const winner = ranked[0]?.result ?? null;
  const stale = props.engineVersion !== props.currentEngineVersion;

  async function recompute() {
    setRecomputing(true);
    setError(null);
    try {
      const response = await fetch(`/api/comparisons/${props.id}/recompute`, { method: 'POST' });
      if (!response.ok) {
        setError('Could not recompute. The original is unchanged.');
        return;
      }
      const created = (await response.json()) as { id?: string };
      if (created.id) window.location.assign(`/compare/${created.id}`);
    } catch {
      setError('Could not reach the server. The original is unchanged.');
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-text-primary">{props.propertyName}</h1>
        <p className="text-sm text-text-secondary">
          {formatDate(props.checkIn)} – {formatDate(props.checkOut)} ·{' '}
          {formatNights(props.nights)} · saved {formatDate(props.createdAt)}
        </p>
      </header>

      {/* §4.3's "subtle note" — present and honest, not alarming. This record is
          correct; it simply predates the current engine. */}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-text-secondary">
            Computed under engine v{props.engineVersion}
            {stale ? ` · the current engine is v${props.currentEngineVersion}` : null}
            {props.recomputedFromId ? ' · recomputed from an earlier comparison' : null}
          </p>
          <p className="text-xs text-text-muted">
            These are the figures as computed at the time. Recomputing creates a new
            comparison and leaves this one exactly as it is.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={recompute} loading={recomputing}>
          Recompute with today&rsquo;s rules
        </Button>
      </Card>

      {error ? (
        <Card className="border-status-critical">
          <p className="text-sm text-text-primary">{error}</p>
        </Card>
      ) : null}

      {props.chosenChannel ? (
        <p className="text-sm text-text-secondary">
          You booked <strong className="text-text-primary">{props.chosenChannel}</strong>
          {winner && winner.channel !== props.chosenChannel ? (
            <>
              {' '}
              — the ranked winner was {winner.label} at {formatCents(winner.effectiveNetCents)}.
            </>
          ) : (
            ' — the ranked winner.'
          )}
        </p>
      ) : null}

      <ChannelBarList ranked={ranked} />

      <FhrAsymmetryNote results={props.results} />

      {winner ? (
        <>
          <ClawbackGuard result={winner} />
          <PriceMatchPanel
            result={winner}
            hasCompetitor={props.context.competitorBaseCents !== null}
          />
        </>
      ) : null}

      <WarningList warnings={props.results.flatMap((result) => result.warnings)} />

      <Disclaimer />
    </div>
  );
}
