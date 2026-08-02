import type { ChannelResult } from '../engine/types';
import { type Cents, atLeastZero, subtractCents } from '../shared/cents';

/**
 * `CHANNEL_CHOICE` — the counterfactual savings event: "you saved X by
 * booking this channel instead of the naive alternative." §8.6 / the task
 * brief that put this module here.
 *
 * This is a **projected** figure, not a realized one. It is derived from a
 * comparison snapshot, not from money that has actually moved — no claim was
 * approved, no credit was burned, no refund landed. `SavingsEvent`'s own
 * invariant (`src/domain/ledger/SavingsEvent.ts`) only requires a `bookingId`
 * or `claimId` when `realized` is true; a projected event carries a
 * `bookingId` anyway, for drill-down (§7.7: "every event is drillable to its
 * booking"), but nothing here depends on that being present.
 */

export interface ChannelChoiceBaseline {
  /** The row the winner is measured against. */
  readonly row: ChannelResult;
  /**
   * Names which baseline was used, for the event's `note` — so the number's
   * meaning survives a user reconciling the ledger against memory or a
   * statement (§1.5 #4). Append to a sentence, e.g. `Booked EDIT ${note}.`
   */
  readonly note: string;
}

/**
 * Picks the baseline a `CHANNEL_CHOICE` saving is measured against.
 *
 * **Prefers the OTA row** when the user entered one: every comparison can be
 * measured against it with the same fixed meaning — "what this stay would
 * have cost through the default consumer booking path, without this app" —
 * which is exactly the traceable, recognisable input §1.5 #4 asks for.
 *
 * **Falls back to the worst-ranked row by sticker total** when there is no
 * OTA row, rather than writing nothing. Coverage of the ledger should not be
 * an accident of which channels the user happened to type in (the defect
 * this module was extracted to fix) — a booking that traces back to a saved
 * comparison should reliably produce an event. "Worst" is deliberately
 * `totalCents`, not `effectiveNetCents`: the saving itself is computed
 * cash-only (see `computeChannelChoiceSavingCents`), so the baseline that
 * defines it must be picked on the same cash basis, or the note describing
 * "vs. the most expensive rate" would not match the number it labels.
 *
 * Returns `null` only when the comparison has no rows to measure against at
 * all — an empty snapshot, which should not occur in practice but is not
 * this function's job to assert against.
 */
export function selectChannelChoiceBaseline(
  results: readonly ChannelResult[],
): ChannelChoiceBaseline | null {
  if (results.length === 0) return null;

  const ota = results.find((row) => row.channel === 'OTA');
  if (ota) {
    return { row: ota, note: 'vs. OTA rate you entered' };
  }

  const worst = results.reduce((worstSoFar, row) =>
    row.totalCents > worstSoFar.totalCents ? row : worstSoFar,
  );
  return { row: worst, note: 'vs. the most expensive rate you entered' };
}

/**
 * The cash-only channel-choice delta: sticker total versus sticker total,
 * nothing else — `baseline.totalCents − winner.totalCents`.
 *
 * Every component this deliberately excludes either isn't statement money or
 * already has its own realized event, and mixing either back in breaks the
 * by-source ledger breakdown:
 *
 * - **Perks (`perksCents`) and points value (`pointsValueCents`)** are
 *   *valuations*, not cash — a breakfast credit or a points redemption never
 *   appears as a line on a credit-card statement. §1.5 #4 requires the
 *   ledger to survive a statement reconciliation, so a figure a statement
 *   can never corroborate cannot be "realized," and folding it into a
 *   cash-only projected figure would overstate what booking-channel choice
 *   alone was worth.
 * - **The statement credit (`creditKeptCents`)** already gets its own
 *   `CREDIT_BURNED` event, written elsewhere in `RecordBookingUseCase`, for
 *   the exact dollars the bucket actually covered. `effectiveNetCents`
 *   already has `creditKeptCents` subtracted, so reading it here — as the
 *   previous formula did — would count the same credit twice: once as
 *   `CREDIT_BURNED`, once folded silently into `CHANNEL_CHOICE`.
 * - **The price-match refund (`refundCents`)** already gets its own
 *   `PRICE_MATCH` event when — and only when — a claim actually resolves
 *   with an award (`TransitionClaimUseCase`). `effectiveNetCents` reflects
 *   the refund as an *estimate* at comparison time; banking that estimate
 *   here, before any claim has actually paid out, would both overstate what
 *   is realized today and double-count the same dollars a second time when
 *   the claim later resolves.
 *
 * Excluding all four is what makes the by-source breakdown (§7.7) sum
 * honestly: `CHANNEL_CHOICE` is exactly the cash difference a user can
 * verify by looking at two booking-page totals, and `CREDIT_BURNED` /
 * `PRICE_MATCH` each carry their own dollars exactly once, when they
 * actually land.
 *
 * Floored at zero: never claim a negative "choice" saving — booking the
 * baseline channel itself, or something that nets worse than it in sticker
 * terms, saved nothing.
 */
export function computeChannelChoiceSavingCents(
  baseline: ChannelResult,
  winner: ChannelResult,
): Cents {
  return atLeastZero(subtractCents(baseline.totalCents, winner.totalCents));
}
