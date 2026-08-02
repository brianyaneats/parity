import { defineRule, VERIFIED_ON, type RuleConstant } from './rule-types';
import type { Cents } from '../shared/cents';

/**
 * Chase Travel Price Match Guarantee — §2.3.1, and Amex's exclusion — §2.3.2.
 *
 * This is the one that matters. The nine conditions are a conjunction, encoded
 * as named predicates so the UI can say *which* one failed (§8.2): "your claim
 * doesn't qualify" is useless, "your claim doesn't qualify because the competing
 * rate is non-refundable" is actionable.
 */

export type PmCondition = 'PM1' | 'PM2' | 'PM3' | 'PM4' | 'PM5' | 'PM6' | 'PM7' | 'PM8' | 'PM9';

export const PM_CONDITION_ORDER: readonly PmCondition[] = Object.freeze([
  'PM1',
  'PM2',
  'PM3',
  'PM4',
  'PM5',
  'PM6',
  'PM7',
  'PM8',
  'PM9',
]);

/**
 * Where a condition can be decided.
 *
 * The pure engine gets no clock and no card, so it can only evaluate the
 * conditions expressible from `StayContext` and `ChannelQuote`. The rest are
 * decided in the application layer, where a booking timestamp and an injected
 * clock exist, and merged into the same `failedConditions` array for the UI.
 * See DECISIONS.md D-016.
 */
export type PmEvaluationSite = 'ENGINE' | 'APPLICATION' | 'USER_ATTESTED';

export interface PmConditionDefinition {
  readonly id: PmCondition;
  /** One-line statement of the condition, as the user should read it. */
  readonly label: string;
  /** The trap inside it — rendered as the "why this matters" line in §7.4. */
  readonly note: string;
  readonly evaluatedAt: PmEvaluationSite;
  /**
   * §8.2: the two highest-risk items are visually emphasised, because they are
   * the two the user can get wrong without noticing.
   */
  readonly highRisk: boolean;
}

export const PM_CONDITIONS: Readonly<Record<PmCondition, PmConditionDefinition>> = Object.freeze({
  PM1: {
    id: 'PM1',
    label: 'Card is Sapphire Reserve, Reserve for Business, or J.P. Morgan Reserve',
    note: 'Sapphire Preferred and Ink Preferred are excluded. Card tier, not card family.',
    evaluatedAt: 'APPLICATION',
    highRisk: false,
  },
  PM2: {
    id: 'PM2',
    label: 'Booking was made through Chase Travel',
    note: 'The Edit qualifies — Chase confirmed this. Amex FHR and The Hotel Collection never do.',
    evaluatedAt: 'ENGINE',
    highRisk: false,
  },
  PM3: {
    id: 'PM3',
    label: 'Booking is prepaid',
    note: 'Pay-at-property bookings cannot be matched.',
    evaluatedAt: 'ENGINE',
    highRisk: false,
  },
  PM4: {
    id: 'PM4',
    label: 'Booking is unmodified and uncancelled',
    note: 'Any change to the reservation voids the claim.',
    evaluatedAt: 'APPLICATION',
    highRisk: false,
  },
  PM5: {
    id: 'PM5',
    label: 'Claim submitted within 24 hours of booking',
    note: 'A hard cutoff measured from the moment you booked, not from check-in.',
    evaluatedAt: 'APPLICATION',
    highRisk: false,
  },
  PM6: {
    id: 'PM6',
    label: 'Check-in is at least 24 hours away',
    note: 'Same-day arrivals cannot be matched.',
    evaluatedAt: 'APPLICATION',
    highRisk: false,
  },
  PM7: {
    id: 'PM7',
    label: 'Nightly base-rate difference is more than $5.00',
    note: 'Strictly more. A gap of exactly $5.00 per night does not qualify.',
    evaluatedAt: 'ENGINE',
    highRisk: false,
  },
  PM8: {
    id: 'PM8',
    label: 'Competing rate matches exactly on every parameter',
    note:
      'Hotel name, address, dates, room type, bed type, refund policy, guest count and currency. ' +
      'A cheaper non-refundable rate never qualifies against a refundable booking — this is the ' +
      'universal denial cause across every programme.',
    evaluatedAt: 'ENGINE',
    highRisk: true,
  },
  PM9: {
    id: 'PM9',
    label: 'Competing rate is publicly available',
    note:
      'Member, loyalty, AAA, AARP, corporate, government, military, group, package, opaque-site ' +
      'and promotional rates are all excluded — even when the membership is free and instant.',
    evaluatedAt: 'ENGINE',
    highRisk: true,
  },
});

/**
 * PM7's floor. The nightly base-rate gap must be **strictly greater** than this.
 * Fixture TC-03 tests immediately below it (482 cents/night, which fails).
 */
export const PM_MIN_NIGHTLY_GAP_RULE: RuleConstant<Cents> = defineRule({
  key: 'CHASE_PM_MIN_NIGHTLY_GAP_CENTS',
  label: 'Chase price match — minimum nightly gap',
  description:
    'The nightly base-rate difference must be strictly greater than this amount. ' +
    'A gap of exactly this value does not qualify.',
  category: 'PRICE_MATCH',
  value: 500 as Cents,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/chase-travel-offering-price-match-guarantee-for-hotel-bookings/',
});

/** PM5. The claim window, measured from booking time — §2.3.1 and §7.4. */
export const PM_CLAIM_WINDOW_HOURS_RULE: RuleConstant<number> = defineRule({
  key: 'CHASE_PM_CLAIM_WINDOW_HOURS',
  label: 'Chase price match — claim window',
  description:
    'Hours after booking within which the claim must be submitted. A hard cutoff; ' +
    'the claim queue exists to defend it.',
  category: 'PRICE_MATCH',
  value: 24,
  unit: 'hours',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://travel-on-points.com/chase-travel-price-match-guarantee/',
});

/** PM6. Minimum lead time before check-in — §2.3.1. */
export const PM_MIN_LEAD_HOURS_RULE: RuleConstant<number> = defineRule({
  key: 'CHASE_PM_MIN_LEAD_HOURS',
  label: 'Chase price match — minimum lead time to check-in',
  description: 'Check-in must be at least this many hours away. No same-day claims.',
  category: 'PRICE_MATCH',
  value: 24,
  unit: 'hours',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://thriftytraveler.com/news/credit-card/chase-travel-hotel-price-match-guarantee/',
});

/**
 * §2.3.2 — the exclusion that drives the entire product.
 *
 * Amex's Lowest Hotel Rate Guarantee applies on amextravel.com but explicitly
 * excludes Fine Hotels + Resorts and The Hotel Collection: precisely the two
 * programmes a Platinum holder would use for a luxury stay. An FHR booking
 * therefore has no price-match backstop at all, and a markup is permanent.
 */
export const AMEX_LRG_EXCLUDES_FHR_THC_RULE: RuleConstant<boolean> = defineRule({
  key: 'AMEX_LRG_EXCLUDES_FHR_THC',
  label: 'Amex guarantee excludes FHR and The Hotel Collection',
  description:
    "Amex's Lowest Hotel Rate Guarantee explicitly excludes Fine Hotels + Resorts and " +
    'The Hotel Collection. An FHR booking has no price-match backstop, which makes The Edit ' +
    'the more defensible portal even when FHR is nominally competitive.',
  category: 'PRICE_MATCH',
  value: true,
  unit: 'boolean',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.americanexpress.com/en-us/travel/faq/travel-benefits/',
});

/**
 * §2.3.1 — partial approval is common, so the full-gap figure is an estimate.
 *
 * One documented Edit claim paid $100 against a $116.31 gap, framed as a
 * courtesy, despite two parameter mismatches. Copy must never promise the full
 * amount (§12).
 */
export const PM_PARTIAL_APPROVAL_COMMON_RULE: RuleConstant<boolean> = defineRule({
  key: 'CHASE_PM_PARTIAL_APPROVAL_COMMON',
  label: 'Chase price match — partial approval is common',
  description:
    'Approval is at the issuer’s discretion and partial payouts are documented. ' +
    'The full gap is modelled as an estimate only, never as a promise.',
  category: 'PRICE_MATCH',
  value: true,
  unit: 'boolean',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/the-edit-by-chase-travel%E2%84%A0-price-match-success-sort-of/',
});

/** §2.3.1: taxes and fees are never refunded, on either side of the comparison. */
export const PM_TAXES_NEVER_REFUNDED_RULE: RuleConstant<boolean> = defineRule({
  key: 'CHASE_PM_TAXES_NEVER_REFUNDED',
  label: 'Chase price match — taxes and fees are never refunded',
  description:
    'Only the base-rate difference is refunded. Taxes and fees are excluded on both sides, ' +
    'which is why the engine compares base rates and never totals.',
  category: 'PRICE_MATCH',
  value: true,
  unit: 'boolean',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.doctorofcredit.com/chase-sapphire-reserve-for-business-price-match-guarantee-on-hotel-bookings-includes-the-edit-bookings/',
});

/** Card kinds that satisfy PM1 — §2.3.1. */
export type CardKind = 'AMEX_PLATINUM' | 'CSR' | 'CSR_BUSINESS' | 'JPM_RESERVE' | 'OTHER';

export const PM_ELIGIBLE_CARD_KINDS: ReadonlySet<CardKind> = Object.freeze(
  new Set<CardKind>(['CSR', 'CSR_BUSINESS', 'JPM_RESERVE']),
);

export const PM_ELIGIBLE_CARDS_RULE: RuleConstant<readonly string[]> = defineRule({
  key: 'CHASE_PM_ELIGIBLE_CARDS',
  label: 'Chase price match — eligible cards',
  description:
    'Sapphire Reserve, Sapphire Reserve for Business and J.P. Morgan Reserve. ' +
    'Sapphire Preferred and Ink Preferred are excluded.',
  category: 'PRICE_MATCH',
  value: Object.freeze(['CSR', 'CSR_BUSINESS', 'JPM_RESERVE']),
  unit: 'count',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://travel-on-points.com/chase-travel-price-match-guarantee/',
});

export const PRICE_MATCH_RULES = Object.freeze([
  PM_MIN_NIGHTLY_GAP_RULE,
  PM_CLAIM_WINDOW_HOURS_RULE,
  PM_MIN_LEAD_HOURS_RULE,
  PM_ELIGIBLE_CARDS_RULE,
  AMEX_LRG_EXCLUDES_FHR_THC_RULE,
  PM_PARTIAL_APPROVAL_COMMON_RULE,
  PM_TAXES_NEVER_REFUNDED_RULE,
]);
