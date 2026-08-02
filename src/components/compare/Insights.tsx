'use client';

import { cn } from '@/lib/cn';
import { formatCents, formatMicroCents, formatPoints } from '@/lib/format';
import { WARNING_COPY } from '@/domain/engine/warnings';
import type {
  BrgResult,
  ChannelResult,
  ComparisonResult,
  EngineWarning,
} from '@/domain/engine/types';

/**
 * The differentiated insights — §8.3, §8.4, §8.5, §8.7.
 *
 * These are the parts no competing tool produces, and the spec is emphatic that
 * they are not footnotes: §8.4 says the FHR asymmetry must be "a persistent
 * note … do not bury it in a tooltip", and §8.3 requires the clawback floor
 * "phrased as an instruction, not a statistic."
 */

/* ------------------------------------------------------------------ §8.3 */

/**
 * The clawback guard.
 *
 * §8.3: "Whenever a booking is about to be recorded on a channel with a live
 * credit bucket, compute and display `minCashFloor = face + expectedRefund`
 * before the user leaves for the portal. Phrase it as an instruction, not a
 * statistic."
 *
 * §13.1's copy rule governs the wording: **name the number and the consequence
 * in the same sentence.** "Charge at least $399" beats "Clawback protection
 * active."
 */
export function ClawbackGuard({ result }: { result: ChannelResult }) {
  if (result.creditFaceCents === 0) return null;

  const floor = result.priceMatch.minCashFloorCents;
  const atRisk = result.clawbackCents > 0;

  return (
    <section
      className={cn(
        'rounded-md border p-4',
        atRisk ? 'border-status-critical bg-surface-1' : 'border-border bg-surface-1',
      )}
    >
      <h3 className="flex items-center gap-2 text-h3 text-text-primary">
        <span aria-hidden="true" className={atRisk ? 'text-status-critical' : 'text-text-muted'}>
          {atRisk ? '!' : '·'}
        </span>
        Before you book
      </h3>

      <p className="mt-1 text-body text-text-primary">
        Charge at least <strong className="tnum">{formatCents(floor)}</strong> to the card and
        cover the rest with points
        {atRisk ? (
          <>
            , or you will lose{' '}
            <strong className="tnum">{formatCents(result.clawbackCents)}</strong> of the{' '}
            {formatCents(result.creditFaceCents)} statement credit.
          </>
        ) : (
          <> to keep the full {formatCents(result.creditFaceCents)} statement credit.</>
        )}
      </p>

      <p className="mt-2 text-sm text-text-secondary">
        A statement credit keys off what you actually charged. A price-match refund lowers that
        charge, and if it falls below the credit&rsquo;s face value the difference is clawed back.
        {result.refundCents > 0 ? (
          <>
            {' '}
            This booking expects a {formatCents(result.refundCents)} refund, which is why the
            floor is above the {formatCents(result.creditFaceCents)} face.
          </>
        ) : null}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ §8.4 */

/**
 * The FHR asymmetry insight.
 *
 * §8.4: "Any comparison containing both an FHR and an Edit quote must render a
 * persistent note explaining that FHR cannot be price matched and The Edit can,
 * with the specific dollar consequence for *this* comparison. This is a
 * differentiated insight; do not bury it in a tooltip."
 */
export function FhrAsymmetryNote({ results }: { results: readonly ChannelResult[] }) {
  const amex = results.find((r) => r.channel === 'FHR' || r.channel === 'THC');
  const edit = results.find((r) => r.channel === 'EDIT' || r.channel === 'CHASE_TRAVEL');
  if (!amex || !edit) return null;

  // The specific dollar consequence for *this* comparison: what the Edit path
  // can recover and the Amex path cannot.
  const recoverable = edit.priceMatch.qualifies ? edit.priceMatch.estimatedRefundCents : 0;
  const amexExposure = amex.priceMatch.gapCents > 0 ? amex.priceMatch.gapCents : 0;

  return (
    <section className="rounded-md border border-border-strong bg-surface-2 p-4">
      <h3 className="text-h3 text-text-primary">
        {amex.label} cannot be price matched. {edit.label} can.
      </h3>

      <p className="mt-1 text-body text-text-secondary">
        American Express excludes Fine Hotels + Resorts and The Hotel Collection from its rate
        guarantee. Chase will match a lower public rate on an Edit booking within 24 hours.
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">Recoverable on {edit.label}</dt>
          <dd className="tnum text-h2 text-text-primary">
            {recoverable > 0 ? formatCents(recoverable) : '—'}
          </dd>
          <p className="text-xs text-text-muted">
            {recoverable > 0
              ? 'If you claim within 24 hours of booking.'
              : 'No qualifying gap against the rate you entered.'}
          </p>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Unrecoverable on {amex.label}</dt>
          <dd className="tnum text-h2 text-text-primary">
            {amexExposure > 0 ? formatCents(amexExposure) : '—'}
          </dd>
          <p className="text-xs text-text-muted">
            {amexExposure > 0
              ? 'Above the competing rate, with no claim available.'
              : 'At or below the competing rate you entered.'}
          </p>
        </div>
      </dl>

      <p className="mt-3 text-sm text-text-secondary">
        This is a difference in risk, not in price. Even where the Amex rate ranks well, its
        downside is uncapped and The Edit&rsquo;s is not.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ §3.5 */

/**
 * The best-rate-guarantee fork.
 *
 * §3.5's critical UI rule: "a BRG result and a Chase price-match result must
 * never be shown as stacking. They are mutually exclusive paths. Render them as
 * a fork with an explicit 'you must choose one' affordance."
 *
 * Fixture TC-08 asserts the app never presents these as additive.
 */
export function BrgFork({
  brg,
  winner,
}: {
  brg: BrgResult;
  winner: ChannelResult | null;
}) {
  return (
    <section className="rounded-md border border-border bg-surface-1 p-4">
      <h3 className="text-h3 text-text-primary">Two paths — you must choose one</h3>
      <p className="mt-1 text-sm text-text-secondary">
        Booking direct to claim {brg.label} means not booking through a portal. These cannot be
        combined, and the savings do not add together.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-sm border border-border-strong p-3">
          <p className="text-label text-text-muted">PATH A · PORTAL</p>
          <p className="mt-1 text-h3 text-text-primary">{winner?.label ?? 'Portal booking'}</p>
          <p className="tnum mt-1 text-h2 text-text-primary">
            {winner ? formatCents(winner.effectiveNetCents) : '—'}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Effective net, after perks, credits, points and any price-match refund.
          </p>
        </div>

        <div className="rounded-sm border border-border-strong p-3">
          <p className="text-label text-text-muted">PATH B · DIRECT + GUARANTEE</p>
          <p className="mt-1 text-h3 text-text-primary">{brg.label}</p>
          <p className="tnum mt-1 text-h2 text-text-primary">{formatCents(brg.newTotalCents)}</p>
          <p className="mt-1 text-xs text-text-muted">
            All-in, matched to {formatCents(brg.matchedBaseCents)} base. {brg.payoutDescription}
            {brg.pointsKicker > 0 ? ` Plus ${formatPoints(brg.pointsKicker)} points.` : ''}
            {brg.giftCardCents > 0 ? ` Plus a ${formatCents(brg.giftCardCents)} gift card.` : ''}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm text-text-secondary">
        Booking direct also earns chain points and elite nights that the portals do not.
        {brg.exclusions ? ` ${brg.exclusions}` : ''}
        {brg.frequencyLimit ? ` ${brg.frequencyLimit}` : ''} Claims must be filed within{' '}
        {brg.claimWindowHours} hours of booking.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ §8.7 */

/**
 * Sensitivity — "how robust is this?"
 *
 * §8.7: "When points exceed 40% of the advantage, emit `POINTS_DOMINATES` and
 * say plainly that the win depends on a valuation assumption rather than money."
 * §13.3 lists this as a feature that must not be cut, because it is one of the
 * two guards against perk and point valuations being gamed into nonsense.
 */
export function SensitivityPanel({ outcome }: { outcome: ComparisonResult }) {
  const sensitivity = outcome.sensitivity;
  if (!sensitivity || !sensitivity.runnerUp) return null;

  const sharePct = Math.round(sensitivity.pointsShareOfAdvantageBps / 100);

  return (
    <section className="rounded-md border border-border bg-surface-1 p-4">
      <h3 className="text-h3 text-text-primary">How robust is this?</h3>

      <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">
            {sensitivity.winner} beats {sensitivity.runnerUp} by
          </dt>
          <dd className="tnum text-h2 text-text-primary">
            {formatCents(sensitivity.advantageCents)}
          </dd>
          <p className="text-xs text-text-muted">
            {sharePct > 0
              ? `${sharePct}% of that lead is the value you assigned to points, not cash.`
              : 'That lead is entirely cash, not points.'}
          </p>
        </div>

        <div>
          <dt className="text-xs text-text-muted">The winner changes when</dt>
          <dd className="tnum text-h2 text-text-primary">
            {sensitivity.urBreakEvenMicro !== null
              ? `UR < ${formatMicroCents(sensitivity.urBreakEvenMicro)}`
              : sensitivity.mrBreakEvenMicro !== null
                ? `MR < ${formatMicroCents(sensitivity.mrBreakEvenMicro)}`
                : 'Never'}
          </dd>
          <p className="text-xs text-text-muted">
            {sensitivity.urBreakEvenMicro !== null || sensitivity.mrBreakEvenMicro !== null
              ? 'Below that valuation, a different channel wins.'
              : 'No points valuation in a plausible range changes this ranking.'}
          </p>
        </div>
      </dl>

      {sensitivity.pointsDominates ? (
        <p className="mt-3 rounded-sm border border-border bg-glass p-2 text-sm text-text-secondary">
          This win rests on an assumption rather than on money. If you value points more
          conservatively than the settings say, the ranking may change with it.
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ §3.7 */

/** Structured engine warnings, rendered from the shared copy table. */
export function WarningList({ warnings }: { warnings: readonly EngineWarning[] }) {
  if (warnings.length === 0) return null;

  const unique = [...new Set(warnings)];

  return (
    <section aria-label="Warnings" className="flex flex-col gap-2">
      {unique.map((warning) => {
        const copy = WARNING_COPY[warning];
        return (
          <div
            key={warning}
            className={cn(
              'rounded-md border p-3',
              copy.severity === 'critical' ? 'border-status-critical' : 'border-border',
              'bg-surface-1',
            )}
          >
            <p className="flex items-start gap-2 text-sm text-text-primary">
              {/* §6.7: never colour alone. A glyph plus a severity word. */}
              <span
                aria-hidden="true"
                className={cn(
                  'font-mono',
                  copy.severity === 'critical' && 'text-status-critical',
                  copy.severity === 'warning' && 'text-status-warning',
                  copy.severity === 'info' && 'text-text-muted',
                )}
              >
                {copy.severity === 'critical' ? '!' : copy.severity === 'warning' ? '▲' : '·'}
              </span>
              <span>
                <span className="sr-only">{copy.severity}: </span>
                {copy.title}
              </span>
            </p>
            <p className="mt-1 pl-5 text-sm text-text-secondary">{copy.detail}</p>
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------- §12 */

/**
 * The persistent disclaimer — §12.
 *
 * "Parity computes estimates from user-supplied rates and published program
 * terms; program terms change; approval is at the issuer's discretion. Never
 * state a refund as guaranteed. Never use the words 'guaranteed savings.'"
 */
export function Disclaimer() {
  return (
    <p className="text-xs text-text-muted">
      Parity computes estimates from the rates you enter and published programme terms. Programme
      terms change, and approval of any claim is at the issuer&rsquo;s discretion. This is not
      financial advice.
    </p>
  );
}
