'use client';

import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/format';
import { PM_CONDITIONS, PM_CONDITION_ORDER, type PmCondition } from '@/domain/rules/price-match.rules';
import type { ChannelResult } from '@/domain/engine/types';

/**
 * The price-match panel — §7.3 item 3 and §8.2.
 *
 * §8.2's reasoning is the whole design: "PM1–PM9 rendered as explicit pass/fail
 * rows rather than a single boolean, because 'your claim doesn't qualify' is
 * useless and 'your claim doesn't qualify because the competing rate is
 * non-refundable' is actionable."
 *
 * Three kinds of row, because three different things are true of them:
 *
 * - **Decided here.** PM2, PM3, PM7, PM8, PM9 — the pure engine can evaluate
 *   them from the quote and the context.
 * - **Decided at booking.** PM1, PM4, PM5, PM6 need a card, a booking
 *   timestamp and a clock, none of which the engine has. Showing them as
 *   "passing" before a booking exists would be a lie, so they render as pending
 *   (DECISIONS.md D-016).
 * - **User-attested.** §8.2: "Conditions the app cannot verify (PM8's
 *   exact-match parameters, PM9's public availability) render as user-attested
 *   toggles with a warning that a false attestation means a denied claim."
 */

export type PmRowState = 'pass' | 'fail' | 'pending' | 'attested';

export interface PriceMatchPanelProps {
  readonly result: ChannelResult;
  /** Null when the user has entered no competing rate — §3.6 says that is not an error. */
  readonly hasCompetitor: boolean;
}

export function PriceMatchPanel({ result, hasCompetitor }: PriceMatchPanelProps) {
  const { priceMatch } = result;

  // §7.3: when the winner is an Amex portal, this panel does something different
  // — it explains that no price match exists and names the recoverable alternative.
  if (!priceMatch.channelEligible) {
    return <NoPriceMatchPath channel={result.label} />;
  }

  if (!hasCompetitor) {
    return (
      <section className="rounded-md border border-border bg-surface-1 p-4">
        <h3 className="text-h3 text-text-primary">Price match</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Add a competing rate to check whether this booking qualifies for a claim.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h3 text-text-primary">Price match — {result.label}</h3>
        <span
          className={cn(
            'rounded-pill px-2 py-0.5 text-label',
            priceMatch.qualifies
              ? 'bg-status-good text-status-ink'
              : 'bg-glass text-text-secondary',
          )}
        >
          {priceMatch.qualifies ? 'QUALIFIES' : 'DOES NOT QUALIFY'}
        </span>
      </div>

      {/* ------------------------------------------------------- the figures */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Figure label="Base-rate gap" value={formatCents(priceMatch.gapCents)} />
        <Figure
          label="Per night"
          value={formatCents(priceMatch.perNightCents)}
          note="Must exceed $5.00"
        />
        <Figure
          label="Estimated refund"
          value={formatCents(priceMatch.estimatedRefundCents)}
          note="An estimate, not a promise"
        />
        <Figure
          label="Tax, never refunded"
          value={formatCents(result.taxCents)}
          note="Excluded on both sides"
        />
      </dl>

      {/* §2.3.1 requires this caveat surfaced, not buried. One documented Edit
          claim paid $100 against a $116.31 gap, framed as a courtesy. */}
      {priceMatch.qualifies ? (
        <p className="mt-3 rounded-sm border border-border bg-glass p-2 text-sm text-text-secondary">
          Partial approval is common. Approval is at Chase&rsquo;s discretion and the amount paid
          can be less than the gap — treat {formatCents(priceMatch.estimatedRefundCents)} as an
          upper bound, not an expectation.
        </p>
      ) : null}

      {/* --------------------------------------------------- the nine conditions */}
      <ol className="mt-4 flex flex-col gap-1.5">
        {PM_CONDITION_ORDER.map((id) => (
          <ConditionRow
            key={id}
            id={id}
            state={stateFor(id, priceMatch.failedConditions)}
          />
        ))}
      </ol>
    </section>
  );
}

function stateFor(id: PmCondition, failed: readonly PmCondition[]): PmRowState {
  if (failed.includes(id)) return 'fail';

  const definition = PM_CONDITIONS[id];
  if (definition.evaluatedAt === 'APPLICATION') return 'pending';
  // PM8 and PM9 depend on what the user attested about the competing rate.
  if (definition.highRisk) return 'attested';
  return 'pass';
}

function ConditionRow({ id, state }: { id: PmCondition; state: PmRowState }) {
  const definition = PM_CONDITIONS[id];

  return (
    <li
      className={cn(
        'flex gap-2 rounded-sm px-2 py-1.5',
        state === 'fail' && 'bg-glass',
        definition.highRisk && state !== 'fail' && 'border border-border',
      )}
    >
      {/* §6.7: colour is never the sole carrier. Every row pairs a glyph, a
          text status word, and the colour. */}
      <StatusGlyph state={state} />
      <div className="min-w-0">
        <p className="text-sm text-text-primary">
          <span className="text-text-muted">{id}</span> — {definition.label}
        </p>
        <p className="text-xs text-text-muted">{definition.note}</p>
        {state === 'attested' ? (
          <p className="text-xs text-text-secondary">
            You confirmed this. A false confirmation means a denied claim.
          </p>
        ) : null}
        {state === 'pending' ? (
          <p className="text-xs text-text-muted">Checked once you record the booking.</p>
        ) : null}
      </div>
    </li>
  );
}

function StatusGlyph({ state }: { state: PmRowState }) {
  const config: Record<PmRowState, { glyph: string; word: string; className: string }> = {
    pass: { glyph: '✓', word: 'Passes', className: 'text-status-good' },
    fail: { glyph: '✕', word: 'Fails', className: 'text-status-critical' },
    pending: { glyph: '·', word: 'Pending', className: 'text-text-muted' },
    attested: { glyph: '!', word: 'You confirmed', className: 'text-status-warning' },
  };
  const { glyph, word, className } = config[state];

  return (
    <span className={cn('mt-0.5 shrink-0 font-mono text-sm', className)} aria-hidden="false">
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{word}: </span>
    </span>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tnum text-h3 text-text-primary">{value}</dd>
      {note ? <p className="text-xs text-text-muted">{note}</p> : null}
    </div>
  );
}

/**
 * What the panel shows for an Amex portal — §7.3.
 *
 * "When the winner is FHR, this panel instead explains that no price match
 * exists for FHR and names The Edit's rate as the recoverable alternative."
 */
function NoPriceMatchPath({ channel }: { channel: string }) {
  return (
    <section className="rounded-md border border-border bg-surface-1 p-4">
      <h3 className="text-h3 text-text-primary">No price-match path — {channel}</h3>
      <p className="mt-1 text-sm text-text-secondary">
        American Express runs a rate guarantee on amextravel.com, but it explicitly excludes
        Fine Hotels + Resorts and The Hotel Collection. If this rate is above market, there is
        no claim to file and the difference is permanent.
      </p>
      <p className="mt-2 text-sm text-text-secondary">
        The Edit can be claimed against within 24 hours of booking. That makes it the more
        defensible portal even when the Amex rate looks competitive — the downside is capped
        on one and uncapped on the other.
      </p>
    </section>
  );
}
