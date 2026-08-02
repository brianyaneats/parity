import { defineRule, VERIFIED_ON, type RuleConstant } from './rule-types';
import type { Cents } from '../shared/cents';
import type { ChainBrand } from './channels.rules';

/**
 * Chain best-rate guarantees — §2.3.3.
 *
 * These require booking **direct with the chain**, so they are mutually
 * exclusive with any portal booking and with the issuer's price match. §3.5
 * makes that a critical UI rule: a BRG result and a Chase price-match result
 * must never be shown as stacking.
 *
 * The universal denial cause across every programme is a cancellation-policy
 * mismatch. A cheaper non-refundable competing rate never qualifies against a
 * refundable booking — §2.3.3 requires this as a blocking validation, not a
 * warning.
 */

/**
 * How a brand states its minimum gap.
 *
 * The spec's table uses two different notations deliberately: "$1/night" for an
 * absolute floor and "> 1%" for a relative one. They are honoured exactly as
 * written — `ABSOLUTE` is inclusive (a *minimum* of $1 means $1 qualifies),
 * `PERCENT` is strictly greater. `GREATER_OF` takes whichever binds harder.
 * See DECISIONS.md D-020.
 */
export type BrgMinimumGapKind = 'ABSOLUTE' | 'PERCENT' | 'GREATER_OF';

export interface BrgMinimumGap {
  readonly kind: BrgMinimumGapKind;
  /** Per-night floor in cents, for `ABSOLUTE` and `GREATER_OF`. */
  readonly perNightCents?: Cents;
  /** Relative floor in basis points of the own base rate, for `PERCENT` and `GREATER_OF`. */
  readonly bps?: number;
  /** Marriott only: a higher floor applies to foreign-currency bookings. */
  readonly foreignCurrencyBps?: number;
}

export interface BrgProgramme {
  readonly brand: ChainBrand;
  readonly label: string;
  /** Discount applied to the matched competitor base, in bps. 2500 = 25% off. */
  readonly discountBps: number;
  /** Alternative fixed points award, where the brand offers a choice. */
  readonly pointsKicker: number;
  /** IHG: 5× points on the stay, capped. */
  readonly pointsMultiplier?: number;
  readonly pointsMultiplierCap?: number;
  /** Choice and Best Western pay a gift card instead of a discount. */
  readonly giftCardCents?: Cents;
  readonly minimumGap: BrgMinimumGap;
  /** Claim window, hours from booking. Same 24 hours across the board — §2.3.3. */
  readonly claimWindowHours: number;
  readonly payoutDescription: string;
  readonly exclusions: string;
  /** Rate-limit note, where one exists. */
  readonly frequencyLimit?: string;
}

/** §2.3.3: the same 24-hour claim window applies across every chain programme. */
export const BRG_CLAIM_WINDOW_HOURS = 24;

const DOLLAR_PER_NIGHT = 100 as Cents;

export const BRG_PROGRAMMES: Readonly<Record<ChainBrand, BrgProgramme>> = Object.freeze({
  HILTON: {
    brand: 'HILTON',
    label: 'Hilton Price Match Guarantee',
    discountBps: 2_500,
    pointsKicker: 0,
    minimumGap: { kind: 'PERCENT', bps: 100 },
    claimWindowHours: BRG_CLAIM_WINDOW_HOURS,
    payoutDescription: 'Matches the lower rate and takes a further 25% off.',
    exclusions: 'Excludes Hampton, some Small Luxury Hotels, and certain EU/AU partner properties.',
  },
  MARRIOTT: {
    brand: 'MARRIOTT',
    label: 'Marriott Look No Further',
    discountBps: 2_500,
    pointsKicker: 5_000,
    minimumGap: { kind: 'ABSOLUTE', perNightCents: DOLLAR_PER_NIGHT, foreignCurrencyBps: 200 },
    claimWindowHours: BRG_CLAIM_WINDOW_HOURS,
    payoutDescription: 'Matches the lower rate and takes a further 25% off, or awards 5,000 points.',
    exclusions:
      'Excludes some Ritz-Carlton properties, all-inclusive resorts, the MGM Collection, and Homes & Villas.',
  },
  HYATT: {
    brand: 'HYATT',
    label: 'Hyatt Best Rate Guarantee',
    discountBps: 2_000,
    pointsKicker: 5_000,
    minimumGap: { kind: 'ABSOLUTE', perNightCents: DOLLAR_PER_NIGHT },
    claimWindowHours: BRG_CLAIM_WINDOW_HOURS,
    payoutDescription: 'Matches the lower rate and takes a further 20% off, or awards 5,000 points.',
    exclusions: 'Up to three rooms per night.',
  },
  IHG: {
    brand: 'IHG',
    label: 'IHG Best Price Guarantee',
    discountBps: 0,
    pointsKicker: 0,
    pointsMultiplier: 5,
    pointsMultiplierCap: 40_000,
    minimumGap: { kind: 'PERCENT', bps: 100 },
    claimWindowHours: BRG_CLAIM_WINDOW_HOURS,
    payoutDescription: 'Matches the lower rate and awards 5× points, capped at 40,000.',
    exclusions: 'Excludes mainland China, Macau, Hong Kong and Taiwan.',
  },
  WYNDHAM: {
    brand: 'WYNDHAM',
    label: 'Wyndham Best Rate Guarantee',
    discountBps: 0,
    pointsKicker: 3_000,
    minimumGap: { kind: 'ABSOLUTE', perNightCents: DOLLAR_PER_NIGHT },
    claimWindowHours: BRG_CLAIM_WINDOW_HOURS,
    payoutDescription: 'Matches the lower rate and awards 3,000 points.',
    exclusions: 'US, Canada and EMEA only.',
    frequencyLimit: 'One claim per calendar month.',
  },
  CHOICE: {
    brand: 'CHOICE',
    label: 'Choice Best Internet Rate Guarantee',
    discountBps: 0,
    pointsKicker: 0,
    giftCardCents: 5_000 as Cents,
    minimumGap: { kind: 'GREATER_OF', perNightCents: DOLLAR_PER_NIGHT, bps: 100 },
    claimWindowHours: BRG_CLAIM_WINDOW_HOURS,
    payoutDescription:
      'Matches the lower rate and adds a $50 gift card (US/Canada), or gives the first night free.',
    exclusions: '',
  },
  BEST_WESTERN: {
    brand: 'BEST_WESTERN',
    label: 'Best Western Best Rate Guarantee',
    discountBps: 0,
    pointsKicker: 0,
    giftCardCents: 10_000 as Cents,
    minimumGap: { kind: 'ABSOLUTE', perNightCents: DOLLAR_PER_NIGHT },
    claimWindowHours: BRG_CLAIM_WINDOW_HOURS,
    payoutDescription: 'Matches the lower rate and adds a $100 gift card.',
    exclusions: '',
    frequencyLimit: 'One claim per 30 days.',
  },
});

/**
 * §2.3.3 — encode as a blocking validation, not a warning.
 *
 * "Universal denial cause, all programs: cancellation-policy mismatch. A
 * cheaper non-refundable competing rate never qualifies against a refundable
 * booking."
 */
export const BRG_CANCELLATION_MISMATCH_BLOCKS_RULE: RuleConstant<boolean> = defineRule({
  key: 'BRG_CANCELLATION_MISMATCH_BLOCKS',
  label: 'Cancellation-policy mismatch blocks every best-rate claim',
  description:
    'The universal denial cause across all chain programmes and both issuer programmes. ' +
    'A cheaper non-refundable competing rate never qualifies against a refundable booking. ' +
    'Enforced as a blocking validation rather than a warning.',
  category: 'BRG',
  value: true,
  unit: 'boolean',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/best-rate-guarantee/',
});

export const BRG_CLAIM_WINDOW_RULE: RuleConstant<number> = defineRule({
  key: 'BRG_CLAIM_WINDOW_HOURS',
  label: 'Chain best-rate guarantee — claim window',
  description: 'Hours after booking within which a chain claim must be filed. Uniform across brands.',
  category: 'BRG',
  value: BRG_CLAIM_WINDOW_HOURS,
  unit: 'hours',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.hilton.com/en/p/price-match-guarantee/',
});

export const BRG_HILTON_DISCOUNT_RULE: RuleConstant<number> = defineRule({
  key: 'BRG_HILTON_DISCOUNT_BPS',
  label: 'Hilton best-rate discount',
  description: 'Hilton matches the lower rate and applies a further 25% discount.',
  category: 'BRG',
  value: 2_500,
  unit: 'bps',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.hilton.com/en/p/price-match-guarantee/',
});

export const BRG_HYATT_DISCOUNT_RULE: RuleConstant<number> = defineRule({
  key: 'BRG_HYATT_DISCOUNT_BPS',
  label: 'Hyatt best-rate discount',
  description: 'Hyatt matches the lower rate and applies a further 20% discount, or awards 5,000 points.',
  category: 'BRG',
  value: 2_000,
  unit: 'bps',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/best-rate-guarantee/',
});

export const BRG_MARRIOTT_DISCOUNT_RULE: RuleConstant<number> = defineRule({
  key: 'BRG_MARRIOTT_DISCOUNT_BPS',
  label: 'Marriott best-rate discount',
  description: 'Marriott matches the lower rate and applies a further 25% discount, or awards 5,000 points.',
  category: 'BRG',
  value: 2_500,
  unit: 'bps',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/best-rate-guarantee/',
});

export const BRG_RULES = Object.freeze([
  BRG_CLAIM_WINDOW_RULE,
  BRG_CANCELLATION_MISMATCH_BLOCKS_RULE,
  BRG_HILTON_DISCOUNT_RULE,
  BRG_HYATT_DISCOUNT_RULE,
  BRG_MARRIOTT_DISCOUNT_RULE,
]);
