import type { Cents } from '../shared/cents';
import {
  ZERO_CENTS,
  cents,
  stripInclusiveBps,
  subtractCents,
  applyBps,
  minCents,
  atLeastZero,
} from '../shared/cents';
import { DomainError } from '../shared/DomainError';
import { CHANNEL_DEFINITIONS } from '../rules/channels.rules';
import { creditFaceFor } from './credit-face';
import { perksFor } from './perks';
import { pointsFor } from './points';
import { assessPriceMatch } from './price-match';
import { channelWarnings } from './warnings';
import type { Channel, ChannelQuote, ChannelResult, StayContext } from './types';

/**
 * Evaluates one channel quote — the fifteen steps of §3.3, in order.
 *
 * **Order is load-bearing.** Credits are computed *after* the refund, because
 * the refund changes the charge the credit keys off. Swapping steps 7 and 8–10
 * produces a plausible, too-generous number in exactly the case (TC-05) where
 * the user most needs the truth.
 *
 * Pure: no I/O, no clock, no randomness, no mutation of its inputs.
 */
export function evaluateChannel(
  quote: ChannelQuote,
  ctx: StayContext,
  quoteIndex = 0,
  label?: string,
): ChannelResult {
  // §3.6 / DECISIONS.md D-017: validation rejects this at the boundary. Reaching
  // here with nights < 1 would divide by zero and put Infinity into a money
  // figure, so it throws rather than guessing.
  if (!Number.isInteger(ctx.nights) || ctx.nights < 1) {
    throw new DomainError(
      'INVALID_NIGHTS',
      `The engine requires at least one night; received ${ctx.nights}.`,
      { nights: ctx.nights },
    );
  }

  // 1–2. Strip the inclusive tax. Tax is computed by subtraction, never by its
  // own rounding, so `base + tax === total` holds exactly for every input —
  // the identity §3.9 asserts as a property.
  const baseCents = stripInclusiveBps(quote.totalCents, ctx.taxRateBps);
  const taxCents = subtractCents(quote.totalCents, baseCents);

  // 3. Perks — only for the three portal channels that grant them.
  const perks = perksFor({
    channel: quote.channel,
    nights: ctx.nights,
    breakfastPerDayCents: ctx.breakfastPerDayCents,
    propertyCreditFaceCents: ctx.propertyCreditFaceCents,
    realizationPct: ctx.realizationPct,
  });

  // 8. The credit face is needed before the price-match assessment so the
  // assessment can report `minCashFloor` alongside the refund it depends on.
  const creditFaceCents = creditFaceFor({
    channel: quote.channel,
    prepaid: quote.prepaid,
    nights: ctx.nights,
    amexBucketAvailable: ctx.amexBucketAvailable,
    editBucketAvailable: ctx.editBucketAvailable,
  });

  // 4–7. Gap, per-night gap, the nine-condition predicate, and the refund.
  const priceMatch = assessPriceMatch({
    channel: quote.channel,
    prepaid: quote.prepaid,
    refundable: quote.refundable,
    baseCents,
    nights: ctx.nights,
    competitorBaseCents: ctx.competitorBaseCents,
    competitorRefundable: ctx.competitorRefundable,
    competitorPublic: ctx.competitorPublic,
    creditFaceCents,
  });
  const refundCents = priceMatch.estimatedRefundCents;

  // 9–11. The clawback rule. A statement credit keys off what was actually
  // charged, and the refund lowered it.
  const netChargeCents = subtractCents(quote.totalCents, refundCents);
  const creditKeptCents = minCents(creditFaceCents, atLeastZero(netChargeCents));
  const clawbackCents = subtractCents(creditFaceCents, creditKeptCents);

  // 12. Points, on the full total for Amex and on the uncovered portion for Chase.
  const points = pointsFor({
    channel: quote.channel,
    prepaid: quote.prepaid,
    totalCents: quote.totalCents,
    netChargeCents,
    creditKeptCents,
    mrValueMicro: ctx.mrValueMicro,
    urValueMicro: ctx.urValueMicro,
  });

  // 13. The Fora rebate. A post-stay rebate, not a discount — it arrives weeks
  // to months after checkout, and the UI is required to say so.
  const rebateCents =
    quote.channel === 'FORA' ? applyBps(quote.totalCents, ctx.foraRateBps) : ZERO_CENTS;

  // 14–15. The ranking key. May legitimately be negative (§3.6, TC-05).
  const effectiveNetCents = cents(
    quote.totalCents -
      perks.totalCents -
      creditKeptCents -
      points.valueCents -
      refundCents -
      rebateCents,
  );
  const effectiveNightlyCents = cents(effectiveNetCents / ctx.nights);

  const warnings = channelWarnings({
    channel: quote.channel,
    prepaid: quote.prepaid,
    nights: ctx.nights,
    totalCents: quote.totalCents,
    perksCents: perks.totalCents,
    creditKeptCents,
    clawbackCents,
    refundCents,
    priceMatch,
  });

  return {
    channel: quote.channel,
    quoteIndex,
    label: label ?? quote.label ?? CHANNEL_DEFINITIONS[quote.channel].label,

    totalCents: quote.totalCents,
    baseCents,
    taxCents,

    perksCents: perks.totalCents,
    breakfastCents: perks.breakfastCents,
    propertyCreditCents: perks.propertyCreditCents,

    creditFaceCents,
    creditKeptCents,
    clawbackCents,

    pointsValueCents: points.valueCents,
    pointsEarned: points.points,

    refundCents,
    rebateCents,

    effectiveNetCents,
    effectiveNightlyCents,

    prepaid: quote.prepaid,
    refundable: quote.refundable,

    priceMatch,
    warnings,
  };
}

/**
 * Builds display labels for a quote set — §3.6, DECISIONS.md D-019.
 *
 * "Same channel entered twice. Allowed. Label by index. Do not dedupe silently."
 * The index suffix is added only when a channel actually repeats, so the common
 * case stays clean.
 */
export function buildQuoteLabels(quotes: readonly ChannelQuote[]): readonly string[] {
  // Two sets rather than a count map: "does this channel repeat" is the only
  // question being asked, and asking it this way leaves no branch that cannot
  // be reached — §10.1 requires 100% of branches here.
  const seenOnce = new Set<Channel>();
  const repeated = new Set<Channel>();
  for (const quote of quotes) {
    if (seenOnce.has(quote.channel)) repeated.add(quote.channel);
    else seenOnce.add(quote.channel);
  }

  const ordinals = new Map<Channel, number>();
  return quotes.map((quote) => {
    if (quote.label) return quote.label;

    const base = CHANNEL_DEFINITIONS[quote.channel].label;
    if (!repeated.has(quote.channel)) return base;

    const ordinal = (ordinals.get(quote.channel) ?? 0) + 1;
    ordinals.set(quote.channel, ordinal);
    return `${base} (${ordinal})`;
  });
}
