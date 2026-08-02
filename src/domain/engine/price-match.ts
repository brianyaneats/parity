import type { Cents } from '../shared/cents';
import { ZERO_CENTS, cents, subtractCents, sumCents } from '../shared/cents';
import type { Channel } from '../rules/channels.rules';
import { PRICE_MATCHABLE_CHANNELS } from '../rules/channels.rules';
import { PM_MIN_NIGHTLY_GAP_RULE, type PmCondition } from '../rules/price-match.rules';
import type { PriceMatchAssessment } from './types';

export interface PriceMatchInput {
  readonly channel: Channel;
  readonly prepaid: boolean;
  readonly refundable: boolean;
  readonly baseCents: Cents;
  readonly nights: number;
  readonly competitorBaseCents: Cents | null;
  readonly competitorRefundable: boolean;
  readonly competitorPublic: boolean;
  /** Credit face, so `minCashFloor` can be reported alongside — §2.4. */
  readonly creditFaceCents: Cents;
}

/**
 * Chase price-match assessment — §3.3 steps 4–7, conditions from §2.3.1.
 *
 * The predicate is deliberately expressed as a list of *named failures* rather
 * than one boolean, because §8.2 requires the UI to say which condition blocked
 * the claim. "Your claim doesn't qualify" is useless; "your claim doesn't
 * qualify because the competing rate is non-refundable" is something the user
 * can act on.
 *
 * Only the five conditions decidable from a quote and a context are evaluated
 * here. PM1 (which card), PM4 (unmodified), PM5 (within 24h of booking) and PM6
 * (check-in ≥ 24h away) need a card, a booking timestamp and a clock — none of
 * which a pure function may have. They are evaluated in the application layer
 * and merged into the same array. See DECISIONS.md D-016.
 */
export function assessPriceMatch(input: PriceMatchInput): PriceMatchAssessment {
  const {
    channel,
    prepaid,
    refundable,
    baseCents,
    nights,
    competitorBaseCents,
    competitorRefundable,
    competitorPublic,
    creditFaceCents,
  } = input;

  const channelEligible = PRICE_MATCHABLE_CHANNELS.has(channel);
  const failed: PmCondition[] = [];

  // PM2 — booking made through Chase Travel. The Edit qualifies; Amex never does.
  if (!channelEligible) failed.push('PM2');

  // PM3 — the booking is prepaid.
  if (!prepaid) failed.push('PM3');

  // §3.3 step 4. A null competitor is "nothing to compare", not an error (§3.6),
  // so the gap is zero rather than undefined.
  const gapCents =
    competitorBaseCents === null ? ZERO_CENTS : subtractCents(baseCents, competitorBaseCents);

  // §3.3 step 5. Rounded half away from zero, which matters here: TC-01's
  // DIRECT_PREPAID row has a negative gap and expects −5991, not −5990.
  const perNightCents = nights > 0 ? cents(gapCents / nights) : ZERO_CENTS;

  // PM7 — strictly greater than the floor. A gap of exactly $5.00/night fails.
  const gapClearsFloor = perNightCents > PM_MIN_NIGHTLY_GAP_RULE.value;
  if (!gapClearsFloor) failed.push('PM7');

  // PM8 — every parameter must match, and the enumerated list includes refund
  // policy. This is what stops a cheaper non-refundable rate being quoted
  // against a refundable booking, the universal denial cause across every
  // programme (§2.3.3). The own booking's refundability is part of the same
  // parameter match, per §3.3 step 6.
  if (!competitorRefundable || !refundable) failed.push('PM8');

  // PM9 — publicly available. Member, loyalty, AAA, corporate, government,
  // military, group, package, opaque and promotional rates are all excluded,
  // even when the membership is free and instant.
  if (!competitorPublic) failed.push('PM9');

  const qualifies = competitorBaseCents !== null && failed.length === 0;

  // §2.3.1: the payout is the base-rate difference. Taxes and fees are never
  // refunded on either side. Modelled as the *estimate* — partial approval is
  // common and no copy in this product may promise the full amount.
  const estimatedRefundCents = qualifies ? gapCents : ZERO_CENTS;

  // §2.4: charge at least this much in cash and cover the rest with points, or
  // the refund drags the charge below the credit face and part of it is clawed
  // back. The single most actionable number the app produces.
  const minCashFloorCents = sumCents(creditFaceCents, estimatedRefundCents);

  return {
    channelEligible,
    failedConditions: Object.freeze(failed),
    gapCents,
    perNightCents,
    qualifies,
    estimatedRefundCents,
    minCashFloorCents,
  };
}
