import type { Cents } from '../shared/cents';
import {
  ZERO_CENTS,
  cents,
  applyBps,
  addInclusiveBps,
  stripInclusiveBps,
  subtractCents,
} from '../shared/cents';
import { BRG_PROGRAMMES, type BrgMinimumGap } from '../rules/brg.rules';
import type { BrandOrNone, BrgResult, StayContext } from './types';

export interface BrgOptions {
  /** Marriott applies a higher relative floor to foreign-currency bookings. */
  readonly foreignCurrency?: boolean;
}

/**
 * Chain best-rate guarantee evaluation — §3.5.
 *
 * > Returns `null` when brand is `NONE`, when there is no competitor rate, when
 * > the gap is ≤ 0, or when the gap misses the brand minimum in §2.3.3.
 *
 * `ownTotalCents` is the **direct** quote's total, because a chain guarantee
 * requires booking direct with the chain. That is also why this is a separate
 * function rather than a field on `ChannelResult`: a BRG and a Chase price match
 * are mutually exclusive paths, and §3.5 requires the UI to render them as a
 * fork with an explicit "you must choose one", never as stacking savings.
 */
export function evaluateBrg(
  ownTotalCents: Cents,
  ctx: StayContext,
  brand: BrandOrNone,
  options: BrgOptions = {},
): BrgResult | null {
  if (brand === 'NONE') return null;
  if (ctx.competitorBaseCents === null) return null;

  const programme = BRG_PROGRAMMES[brand];
  const ownBaseCents = stripInclusiveBps(ownTotalCents, ctx.taxRateBps);
  const gapCents = subtractCents(ownBaseCents, ctx.competitorBaseCents);

  if (gapCents <= 0) return null;

  // §2.3.3, universal denial cause: a cheaper non-refundable competing rate
  // never qualifies against a refundable booking. Encoded as a blocking
  // validation, not a warning.
  if (!ctx.competitorRefundable) return null;
  if (!ctx.competitorPublic) return null;

  if (!clearsMinimumGap(gapCents, ownBaseCents, ctx.nights, programme.minimumGap, options)) {
    return null;
  }

  // The brand matches the competing rate, then applies its own kicker. For
  // Hyatt that is a further 20% off, which is what makes TC-08's matched base
  // 155840 rather than the bare 194800.
  const matchedBaseCents = applyBps(
    ctx.competitorBaseCents,
    10_000 - programme.discountBps,
  );
  const newTotalCents = addInclusiveBps(matchedBaseCents, ctx.taxRateBps);

  return {
    brand,
    label: programme.label,
    matchedBaseCents,
    newTotalCents,
    originalTotalCents: ownTotalCents,
    savingCents: subtractCents(ownTotalCents, newTotalCents),
    // DECISIONS.md D-023: IHG's "5× points, capped at 40,000" needs a base
    // earning rate the spec does not give. Inventing one would be inventing a
    // programme rule, which §13.4 forbids, so the numeric kicker stays 0 and
    // the payout text carries the truth.
    pointsKicker: programme.pointsKicker,
    giftCardCents: programme.giftCardCents ?? ZERO_CENTS,
    discountBps: programme.discountBps,
    payoutDescription: programme.payoutDescription,
    exclusions: programme.exclusions,
    frequencyLimit: programme.frequencyLimit ?? null,
    claimWindowHours: programme.claimWindowHours,
  };
}

/**
 * Whether the gap clears the brand's minimum — §2.3.3.
 *
 * The spec's table uses two notations deliberately: "$1/night" is an absolute
 * floor stated as a *minimum* (so an exactly-equal gap qualifies), while "> 1%"
 * is written with an explicit strict inequality. Both are honoured as written.
 * Where a brand states both ("greater of $1 or 1%"), the harder threshold binds
 * and the strict comparison applies. See DECISIONS.md D-020 and D-021.
 */
function clearsMinimumGap(
  gapCents: Cents,
  ownBaseCents: Cents,
  nights: number,
  minimum: BrgMinimumGap,
  options: BrgOptions,
): boolean {
  const absoluteThreshold = cents((minimum.perNightCents ?? 0) * nights);

  // The relative floor is taken against the user's own base rate — the larger
  // of the two figures — which makes the threshold harder to clear and so
  // under-claims eligibility rather than over-claiming it (§0.3 item 3).
  const relativeBps =
    options.foreignCurrency && minimum.foreignCurrencyBps !== undefined
      ? minimum.foreignCurrencyBps
      : (minimum.bps ?? 0);
  const relativeThreshold = applyBps(ownBaseCents, relativeBps);

  // A relative floor stated with an explicit ">" is strictly greater; an
  // absolute floor stated as a "minimum" is inclusive. Written as if/else
  // rather than a switch with an unreachable default, so every branch here is
  // a branch the tests can actually reach.
  if (minimum.kind === 'PERCENT') {
    return gapCents > relativeThreshold;
  }

  if (minimum.kind === 'GREATER_OF') {
    return gapCents > Math.max(absoluteThreshold, relativeThreshold);
  }

  // ABSOLUTE. Marriott's foreign-currency case adds a relative floor on top.
  if (options.foreignCurrency && minimum.foreignCurrencyBps !== undefined) {
    return gapCents >= absoluteThreshold && gapCents > relativeThreshold;
  }
  return gapCents >= absoluteThreshold;
}
