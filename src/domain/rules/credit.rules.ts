import { defineRule, VERIFIED_ON, type RuleConstant } from './rule-types';
import type { Cents } from '../shared/cents';
import type { Channel } from './channels.rules';

/**
 * Statement credit buckets — §2.4.
 *
 * Six buckets, each an independent row in `credit_buckets` with its own window
 * and unlock condition. These constants are the *seed definitions*; live
 * availability is always read from the database, because a bucket's remaining
 * balance is state, not a rule.
 */

export type CreditBucketKey =
  | 'AMEX_HOTEL_H1'
  | 'AMEX_HOTEL_H2'
  | 'CSR_EDIT_H1'
  | 'CSR_EDIT_H2'
  | 'CSR_BRANDS'
  | 'CSR_TRAVEL';

export type CreditWindowKind = 'CALENDAR_H1' | 'CALENDAR_H2' | 'FIXED' | 'CARDMEMBER_YEAR';

export interface CreditBucketDefinition {
  readonly key: CreditBucketKey;
  readonly label: string;
  /** Which card the bucket belongs to, for the §7.5 grouping. */
  readonly card: 'AMEX_PLATINUM' | 'CSR';
  readonly faceCents: Cents;
  readonly windowKind: CreditWindowKind;
  /** Only for `FIXED` windows. ISO date. */
  readonly fixedWindowEnd?: string;
  /** Channels that can unlock this bucket. */
  readonly unlockChannels: readonly Channel[];
  /** Minimum nights for the unlock, if any. */
  readonly minNights: number;
  /** Whether the booking must be prepaid to unlock it. */
  readonly requiresPrepaid: boolean;
  readonly unlockDescription: string;
}

export const AMEX_HOTEL_CREDIT_FACE_CENTS = 30_000 as Cents;
export const CSR_EDIT_CREDIT_FACE_CENTS = 25_000 as Cents;
export const CSR_BRANDS_CREDIT_FACE_CENTS = 25_000 as Cents;
export const CSR_TRAVEL_CREDIT_FACE_CENTS = 30_000 as Cents;

/** §2.4: THC and The Edit both require a two-night stay to unlock their credit. */
export const CREDIT_MIN_NIGHTS_RULE: RuleConstant<number> = defineRule({
  key: 'CREDIT_MIN_NIGHTS_THC_EDIT',
  label: 'Two-night minimum — The Hotel Collection and The Edit',
  description:
    'The Hotel Collection and The Edit each require a stay of at least this many nights ' +
    'before their statement credit unlocks. Fine Hotels + Resorts has no such minimum.',
  category: 'STATEMENT_CREDIT',
  value: 2,
  unit: 'nights',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.chase.com/travel/guide/hotels/the-edit-chase-travel-credits-benefits',
});

export const AMEX_HOTEL_CREDIT_RULE: RuleConstant<Cents> = defineRule({
  key: 'AMEX_HOTEL_CREDIT_FACE_CENTS',
  label: 'Amex Platinum hotel credit — semiannual face value',
  description:
    '$600/year in two $300 semiannual buckets. Unlocked by a prepaid Fine Hotels + Resorts ' +
    'booking of any length, or a two-night Hotel Collection booking, via Amex Travel.',
  category: 'STATEMENT_CREDIT',
  value: AMEX_HOTEL_CREDIT_FACE_CENTS,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.americanexpress.com/en-us/travel/benefits/how-to-use-hotel-credit',
});

export const CSR_EDIT_CREDIT_RULE: RuleConstant<Cents> = defineRule({
  key: 'CSR_EDIT_CREDIT_FACE_CENTS',
  label: 'Sapphire Reserve The Edit credit — semiannual face value',
  description:
    '$500/year in two $250 semiannual buckets. Requires a prepaid Edit booking of at least ' +
    'two nights.',
  category: 'STATEMENT_CREDIT',
  value: CSR_EDIT_CREDIT_FACE_CENTS,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.chase.com/travel/guide/hotels/the-edit-chase-travel-credits-benefits',
});

export const CSR_BRANDS_CREDIT_RULE: RuleConstant<Cents> = defineRule({
  key: 'CSR_BRANDS_CREDIT_FACE_CENTS',
  label: 'Sapphire Reserve select-brands hotel credit',
  description: '$250 through 31 December 2026, on select brands booked via Chase Travel.',
  category: 'STATEMENT_CREDIT',
  value: CSR_BRANDS_CREDIT_FACE_CENTS,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.chase.com/travel/guide/hotels/the-edit-chase-travel-credits-benefits',
});

export const CSR_TRAVEL_CREDIT_RULE: RuleConstant<Cents> = defineRule({
  key: 'CSR_TRAVEL_CREDIT_FACE_CENTS',
  label: 'Sapphire Reserve broad travel credit',
  description:
    '$300 per cardmember year, against broad travel spend. The window runs from the ' +
    'user-set cardmember anniversary.',
  category: 'STATEMENT_CREDIT',
  value: CSR_TRAVEL_CREDIT_FACE_CENTS,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.chase.com/travel/guide/hotels/the-edit-chase-travel-credits-benefits',
});

export const CREDIT_BUCKET_DEFINITIONS: readonly CreditBucketDefinition[] = Object.freeze([
  {
    key: 'AMEX_HOTEL_H1',
    label: 'Amex hotel credit · Jan–Jun',
    card: 'AMEX_PLATINUM',
    faceCents: AMEX_HOTEL_CREDIT_FACE_CENTS,
    windowKind: 'CALENDAR_H1',
    unlockChannels: ['FHR', 'THC'],
    minNights: 1,
    requiresPrepaid: true,
    unlockDescription: 'Prepaid Fine Hotels + Resorts (any length) or The Hotel Collection (2+ nights) via Amex Travel.',
  },
  {
    key: 'AMEX_HOTEL_H2',
    label: 'Amex hotel credit · Jul–Dec',
    card: 'AMEX_PLATINUM',
    faceCents: AMEX_HOTEL_CREDIT_FACE_CENTS,
    windowKind: 'CALENDAR_H2',
    unlockChannels: ['FHR', 'THC'],
    minNights: 1,
    requiresPrepaid: true,
    unlockDescription: 'Prepaid Fine Hotels + Resorts (any length) or The Hotel Collection (2+ nights) via Amex Travel.',
  },
  {
    key: 'CSR_EDIT_H1',
    label: 'The Edit credit · Jan–Jun',
    card: 'CSR',
    faceCents: CSR_EDIT_CREDIT_FACE_CENTS,
    windowKind: 'CALENDAR_H1',
    unlockChannels: ['EDIT'],
    minNights: 2,
    requiresPrepaid: true,
    unlockDescription: 'Prepaid Edit booking, two-night minimum.',
  },
  {
    key: 'CSR_EDIT_H2',
    label: 'The Edit credit · Jul–Dec',
    card: 'CSR',
    faceCents: CSR_EDIT_CREDIT_FACE_CENTS,
    windowKind: 'CALENDAR_H2',
    unlockChannels: ['EDIT'],
    minNights: 2,
    requiresPrepaid: true,
    unlockDescription: 'Prepaid Edit booking, two-night minimum.',
  },
  {
    key: 'CSR_BRANDS',
    label: 'Select-brands hotel credit',
    card: 'CSR',
    faceCents: CSR_BRANDS_CREDIT_FACE_CENTS,
    windowKind: 'FIXED',
    fixedWindowEnd: '2026-12-31',
    unlockChannels: ['CHASE_TRAVEL', 'EDIT'],
    minNights: 1,
    requiresPrepaid: false,
    unlockDescription: 'Select brands booked through Chase Travel, through 31 December 2026.',
  },
  {
    key: 'CSR_TRAVEL',
    label: 'Broad travel credit',
    card: 'CSR',
    faceCents: CSR_TRAVEL_CREDIT_FACE_CENTS,
    windowKind: 'CARDMEMBER_YEAR',
    unlockChannels: ['EDIT', 'CHASE_TRAVEL', 'DIRECT_FLEX', 'DIRECT_PREPAID', 'OTA', 'PHONE'],
    minNights: 1,
    requiresPrepaid: false,
    unlockDescription: 'Broad travel spend, over the cardmember year from your anniversary date.',
  },
]);

/**
 * §7.5 — the status thresholds for a bucket meter, in days remaining.
 * Beyond 60 days is neutral, 30–60 warns, under 30 is critical.
 */
export const BUCKET_WARNING_DAYS = 60;
export const BUCKET_CRITICAL_DAYS = 30;

/** §9 — when the expiry sweep notifies. */
export const BUCKET_NOTIFY_DAYS_BEFORE: readonly number[] = Object.freeze([60, 30, 14, 3]);

export const CREDIT_RULES = Object.freeze([
  AMEX_HOTEL_CREDIT_RULE,
  CSR_EDIT_CREDIT_RULE,
  CSR_BRANDS_CREDIT_RULE,
  CSR_TRAVEL_CREDIT_RULE,
  CREDIT_MIN_NIGHTS_RULE,
]);
