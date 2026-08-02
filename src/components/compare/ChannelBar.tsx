'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatCents, formatDelta, formatNet, formatPoints } from '@/lib/format';
import { CHANNEL_DEFINITIONS } from '@/domain/rules/channels.rules';
import type { RankedEntry } from '@/domain/engine/types';

/**
 * The ranked bar row — §8.1.
 *
 * Row grammar, exactly as specified: `[name + sublabel] [bar track] [value + badge]`.
 *
 * Three details in §8.1 carry the design:
 *
 * 1. **Bar length is `net / max(all totals)`**, not `net / max(all nets)`. Using
 *    the totals keeps bars comparable across channels — a channel whose perks
 *    swallow most of its sticker reads as a genuinely short bar rather than
 *    being rescaled back to full width.
 * 2. **A dashed extension from `net` to `net + refund`** where a price-match
 *    refund applies. §8.1 prefers this to a colour change because it shows
 *    *what the claim removed*, which is the more informative fact — and because
 *    §6.7 forbids colour as the sole carrier of meaning anyway.
 * 3. **Clamp the bar at zero when the net is negative, but print the true
 *    value.** §3.6 is explicit: the engine returns the real negative number and
 *    the UI must not launder it into a zero.
 *
 * At ≤ 640px this collapses to a stacked card with the same numbers and no
 * horizontal scroll (§6.7) — the bar track is simply hidden, because a 40px bar
 * on a phone encodes nothing.
 */

export interface ChannelBarProps {
  readonly entry: RankedEntry;
  /** `max(all totals)` across the comparison — the shared denominator. */
  readonly scaleCents: number;
  readonly isWinner: boolean;
  /** Names the channel the delta is measured against, for the screen reader. */
  readonly winnerLabel: string;
}

export function ChannelBar({ entry, scaleCents, isWinner, winnerLabel }: ChannelBarProps) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const { result } = entry;

  const definition = CHANNEL_DEFINITIONS[result.channel];
  const denominator = Math.max(scaleCents, 1);

  // Clamped for geometry only. The printed figure below is always the true one.
  const netWidthPct = clampPct((Math.max(result.effectiveNetCents, 0) / denominator) * 100);
  const refundWidthPct = clampPct((result.refundCents / denominator) * 100);

  return (
    <li
      className={cn(
        'group grid gap-2 rounded-md border px-3 py-3 transition-colors duration-fast ease-standard',
        'grid-cols-1 lg:grid-cols-[minmax(0,15rem)_1fr_minmax(0,9rem)] lg:items-center lg:gap-4',
        isWinner ? 'border-border-strong bg-surface-2' : 'border-border bg-surface-1',
      )}
      data-winner={isWinner || undefined}
    >
      {/* ---------------------------------------------------- name + sublabel */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-h3 text-text-primary">{result.label}</span>
          {isWinner ? (
            <span className="shrink-0 rounded-pill bg-accent-lime px-2 py-0.5 text-label text-accent-lime-ink">
              BEST
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-text-muted">{definition.sublabel}</p>
      </div>

      {/* ------------------------------------------------------------- the bar */}
      {/* Hidden below lg: a bar this short on a phone encodes nothing, and §6.7
          requires the numbers to stay legible without horizontal scroll. */}
      <div
        className="relative hidden h-6 w-full overflow-hidden rounded-sm bg-glass lg:block"
        role="img"
        aria-label={`Effective net ${formatNet(result.effectiveNetCents)}${
          result.refundCents > 0
            ? `, after an estimated ${formatCents(result.refundCents)} price-match refund`
            : ''
        }`}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-sm transition-[width] duration-base ease-standard',
            isWinner ? 'bg-accent-lime' : 'bg-brand',
          )}
          style={{ width: `${netWidthPct}%` }}
        />
        {/* What the claim removed. Dashed, so it reads as "would have been"
            rather than as additional cost. */}
        {result.refundCents > 0 ? (
          <div
            className="absolute inset-y-0 rounded-sm border border-dashed border-border-strong transition-[width,left] duration-base ease-standard"
            style={{ left: `${netWidthPct}%`, width: `${refundWidthPct}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      {/* ------------------------------------------------------ value + delta */}
      <div className="flex items-baseline justify-between gap-2 lg:flex-col lg:items-end lg:gap-0">
        <span className="tnum text-h3 text-text-primary">{formatNet(result.effectiveNetCents)}</span>
        <span className="tnum text-xs text-text-muted">
          {isWinner ? (
            <span className="sr-only">Best option</span>
          ) : (
            <>
              {formatDelta(entry.deltaFromWinnerCents)}
              <span className="sr-only"> more than {winnerLabel}</span>
            </>
          )}
        </span>
      </div>

      {/* ------------------------------------------------------- the breakdown */}
      {/* §7.3: "Every figure in the results column is traceable." §0.5 bans a
          modal that could have been an inline expansion, so this is inline. */}
      <div className="lg:col-span-3">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={detailId}
          className="rounded-sm text-xs text-text-secondary underline-offset-2 hover:underline"
        >
          {expanded ? 'Hide breakdown' : 'Show breakdown'}
        </button>

        {expanded ? (
          <dl id={detailId} className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <Figure label="Sticker (incl. tax)" value={formatCents(result.totalCents)} />
            <Figure label="Base rate" value={formatCents(result.baseCents)} />
            <Figure
              label="Tax and fees"
              value={formatCents(result.taxCents)}
              note="Never refunded by any programme"
            />
            {result.perksCents > 0 ? (
              <Figure
                label="Perks"
                value={`− ${formatCents(result.perksCents)}`}
                note={`${formatCents(result.breakfastCents)} breakfast + ${formatCents(
                  result.propertyCreditCents,
                )} property credit`}
              />
            ) : null}
            {result.creditFaceCents > 0 ? (
              <Figure
                label="Statement credit kept"
                value={`− ${formatCents(result.creditKeptCents)}`}
                note={
                  result.clawbackCents > 0
                    ? `${formatCents(result.clawbackCents)} clawed back`
                    : `of ${formatCents(result.creditFaceCents)} face`
                }
              />
            ) : null}
            {result.pointsValueCents > 0 ? (
              <Figure
                label="Points value"
                value={`− ${formatCents(result.pointsValueCents)}`}
                note={
                  result.pointsEarned > 0 ? `${formatPoints(result.pointsEarned)} points` : 'cash-equivalent'
                }
              />
            ) : null}
            {result.refundCents > 0 ? (
              <Figure
                label="Est. price-match refund"
                value={`− ${formatCents(result.refundCents)}`}
                note="An estimate — partial approval is common"
              />
            ) : null}
            {result.rebateCents > 0 ? (
              <Figure
                label="Fora rebate"
                value={`− ${formatCents(result.rebateCents)}`}
                note="Paid after checkout, not a discount at booking"
              />
            ) : null}
            <Figure
              label="Effective net"
              value={formatNet(result.effectiveNetCents)}
              note={`${formatCents(result.effectiveNightlyCents)} per night`}
              emphasis
            />
          </dl>
        ) : null}
      </div>
    </li>
  );
}

function Figure({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd
        className={cn(
          'tnum text-sm',
          emphasis ? 'text-text-primary' : 'text-text-secondary',
        )}
      >
        {value}
      </dd>
      {note ? <p className="text-xs text-text-muted">{note}</p> : null}
    </div>
  );
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * The ranked list. §8.1's shared denominator is computed once here so every bar
 * in the list is drawn to the same scale.
 */
export function ChannelBarList({ ranked }: { ranked: readonly RankedEntry[] }) {
  if (ranked.length === 0) return null;

  const scaleCents = Math.max(...ranked.map((entry) => entry.result.totalCents));
  const winnerLabel = ranked[0]?.result.label ?? '';

  return (
    <ul className="flex flex-col gap-2" aria-label="Channels ranked by effective net cost">
      {ranked.map((entry) => (
        <ChannelBar
          key={`${entry.result.channel}-${entry.result.quoteIndex}`}
          entry={entry}
          scaleCents={scaleCents}
          isWinner={entry.rank === 1}
          winnerLabel={winnerLabel}
        />
      ))}
    </ul>
  );
}
