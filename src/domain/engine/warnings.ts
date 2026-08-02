import type { Cents } from '../shared/cents';
import { sumCents } from '../shared/cents';
import type { Channel } from '../rules/channels.rules';
import { CHANNEL_DEFINITIONS } from '../rules/channels.rules';
import { missesNightMinimum } from './credit-face';
import { forfeitsPrepaidMultiplier } from './points';
import type { EngineWarning, PriceMatchAssessment } from './types';

export interface ChannelWarningInput {
  readonly channel: Channel;
  readonly prepaid: boolean;
  readonly nights: number;
  readonly totalCents: Cents;
  readonly perksCents: Cents;
  readonly creditKeptCents: Cents;
  readonly clawbackCents: Cents;
  readonly refundCents: Cents;
  readonly priceMatch: PriceMatchAssessment;
}

/**
 * Per-channel warnings — §3.7.
 *
 * Structured, not strings, so the UI renders them consistently and the fixtures
 * can assert on them. Order is stable so snapshot diffs stay readable.
 */
export function channelWarnings(input: ChannelWarningInput): readonly EngineWarning[] {
  const warnings: EngineWarning[] = [];
  const {
    channel,
    prepaid,
    nights,
    totalCents,
    perksCents,
    creditKeptCents,
    clawbackCents,
    refundCents,
    priceMatch,
  } = input;

  // Paying at the property drops Membership Rewards earning from 5× to 1×.
  // §2.5 calls this "a common and expensive mistake" and requires the warning.
  // Generalised from FHR to THC, which earns identically — DECISIONS.md D-011.
  if (forfeitsPrepaidMultiplier(channel, prepaid)) {
    warnings.push('FHR_PAY_AT_PROPERTY_1X');
  }

  // A stay under two nights cannot unlock The Edit's or The Hotel Collection's
  // credit. Generalised from the spec's Edit-only wording because the rule and
  // the consequence are identical — DECISIONS.md D-022.
  if (missesNightMinimum(channel, nights)) {
    warnings.push('EDIT_UNDER_TWO_NIGHTS');
  }

  // The refund dragged the charge below the credit face and part of the credit
  // evaporated. This is what `minCashFloor` exists to prevent.
  if (clawbackCents > 0) {
    warnings.push('CLAWBACK_RISK');
  }

  // §3.6: perks plus credits plus refund can exceed a cheap stay's total, which
  // makes the effective net legitimately negative. The engine still returns the
  // true number, but the user is told to check their breakfast valuation rather
  // than being congratulated on a fictional windfall.
  if (sumCents(perksCents, creditKeptCents, refundCents) > totalCents) {
    warnings.push('OVER_SUBSIDIZED');
  }

  // A real gap exists on a price-matchable channel, but the competing rate
  // fails the parameter match or the public-availability test. The gap is
  // visible and unclaimable, which is exactly the case worth naming.
  const blockedByRateQuality =
    priceMatch.failedConditions.includes('PM8') || priceMatch.failedConditions.includes('PM9');
  if (priceMatch.channelEligible && priceMatch.gapCents > 0 && blockedByRateQuality) {
    warnings.push('COMPETITOR_NON_REFUNDABLE');
  }

  // §2.3.2, the asymmetry that drives the product: Amex's guarantee excludes
  // Fine Hotels + Resorts and The Hotel Collection, so a markup on either is
  // permanent. Fires whenever an Amex portal quote sits alongside a real gap it
  // can never claim against. Fixture TC-06 is the tripwire for the inverse bug —
  // applying Chase's price-match logic to an Amex channel.
  const isAmexPortal = channel === 'FHR' || channel === 'THC';
  if (isAmexPortal && priceMatch.gapCents > 0) {
    warnings.push('FHR_NO_PRICE_MATCH');
  }

  return Object.freeze(warnings);
}

/** Human-readable copy for each warning. Never states a refund as guaranteed — §12. */
export const WARNING_COPY: Readonly<
  Record<EngineWarning, { readonly title: string; readonly detail: string; readonly severity: 'warning' | 'critical' | 'info' }>
> = Object.freeze({
  FHR_PAY_AT_PROPERTY_1X: {
    title: 'Paying at the property drops you to 1× points',
    detail:
      'Prepaying this booking earns 5× Membership Rewards on the full total. Paying at the ' +
      'property earns 1×. The difference is already reflected in the ranking below.',
    severity: 'warning',
  },
  EDIT_UNDER_TWO_NIGHTS: {
    title: 'Under two nights — the statement credit cannot unlock',
    detail:
      'The Edit and The Hotel Collection each require a two-night stay before their credit ' +
      'applies. This comparison assumes no credit for that channel.',
    severity: 'warning',
  },
  CLAWBACK_RISK: {
    title: 'Part of your statement credit will be clawed back',
    detail:
      'A price-match refund lowers what you actually charged, and the credit keys off the ' +
      'charge. Charge at least the cash floor shown and cover the rest with points.',
    severity: 'critical',
  },
  OVER_SUBSIDIZED: {
    title: 'Your perks and credits exceed the room cost',
    detail:
      'Check your breakfast valuation — a perk is worth what you would otherwise have paid, ' +
      'not the menu price. The figure below is still computed from your inputs as entered.',
    severity: 'warning',
  },
  COMPETITOR_NON_REFUNDABLE: {
    title: 'The competing rate does not match your booking’s terms',
    detail:
      'A cheaper non-refundable rate never qualifies against a refundable booking, and a ' +
      'member-only rate never qualifies at all. This is the most common reason claims are denied.',
    severity: 'warning',
  },
  FHR_NO_PRICE_MATCH: {
    title: 'Fine Hotels + Resorts has no price-match backstop',
    detail:
      'Amex’s rate guarantee explicitly excludes Fine Hotels + Resorts and The Hotel Collection. ' +
      'If this rate is above market you cannot recover the difference. The Edit can be claimed against.',
    severity: 'critical',
  },
  BRG_AVAILABLE_NOT_TAKEN: {
    title: 'Booking direct and claiming the chain guarantee would beat this winner',
    detail:
      'The chain’s best-rate guarantee is a separate path. It cannot be combined with a portal ' +
      'booking or an issuer price match — you have to choose one.',
    severity: 'info',
  },
  POINTS_DOMINATES: {
    title: 'This win rests on your points valuation, not on cash',
    detail:
      'More than 40% of the winner’s advantage is the value you assigned to points. Change that ' +
      'assumption and the ranking may change with it.',
    severity: 'info',
  },
});
