import { defineRule, VERIFIED_ON, type RuleConstant } from './rule-types';
import type { Micro } from '../shared/cents';
import type { Channel } from './channels.rules';

/**
 * Points earning — §2.5.
 *
 * Two things here are load-bearing:
 *
 * 1. **`FHR` pay-at-property earns 1×, not 5×.** §2.5 calls this "a common and
 *    expensive mistake" and requires a UI warning. On a $3,600 stay that is
 *    $216 of Membership Rewards silently forfeited.
 * 2. **The Chase channels earn on `netCharge − creditKept`**, i.e. only the
 *    portion no statement credit covered. Earning on the full total would
 *    overstate every Edit comparison.
 */

export type PointsCurrency = 'MR' | 'UR' | 'CASH_EQUIVALENT' | 'NONE';

export interface PointsEarningRule {
  readonly channel: Channel;
  readonly currency: PointsCurrency;
  /** Points per dollar when prepaid. */
  readonly prepaidMultiplier: number;
  /** Points per dollar when paying at the property. */
  readonly payAtPropertyMultiplier: number;
  /**
   * Whether earning is computed on `netCharge − creditKept` rather than the
   * full total. True only for the Chase channels.
   */
  readonly earnsNetOfCredit: boolean;
}

export const POINTS_EARNING: Readonly<Record<Channel, PointsEarningRule>> = Object.freeze({
  FHR: {
    channel: 'FHR',
    currency: 'MR',
    prepaidMultiplier: 5,
    payAtPropertyMultiplier: 1,
    earnsNetOfCredit: false,
  },
  // DECISIONS.md D-011: §2.2 marks THC as always prepaid, so a non-prepaid THC
  // quote is unspecified but enterable. Treated exactly like non-prepaid FHR —
  // the conservative reading, which under-claims rather than over-claims.
  THC: {
    channel: 'THC',
    currency: 'MR',
    prepaidMultiplier: 5,
    payAtPropertyMultiplier: 1,
    earnsNetOfCredit: false,
  },
  EDIT: {
    channel: 'EDIT',
    currency: 'UR',
    prepaidMultiplier: 8,
    payAtPropertyMultiplier: 8,
    earnsNetOfCredit: true,
  },
  CHASE_TRAVEL: {
    channel: 'CHASE_TRAVEL',
    currency: 'UR',
    prepaidMultiplier: 8,
    payAtPropertyMultiplier: 8,
    earnsNetOfCredit: true,
  },
  DIRECT_FLEX: {
    channel: 'DIRECT_FLEX',
    currency: 'NONE',
    prepaidMultiplier: 0,
    payAtPropertyMultiplier: 0,
    earnsNetOfCredit: false,
  },
  DIRECT_PREPAID: {
    channel: 'DIRECT_PREPAID',
    currency: 'NONE',
    prepaidMultiplier: 0,
    payAtPropertyMultiplier: 0,
    earnsNetOfCredit: false,
  },
  OTA: {
    channel: 'OTA',
    currency: 'CASH_EQUIVALENT',
    prepaidMultiplier: 0,
    payAtPropertyMultiplier: 0,
    earnsNetOfCredit: false,
  },
  FORA: {
    channel: 'FORA',
    currency: 'NONE',
    prepaidMultiplier: 0,
    payAtPropertyMultiplier: 0,
    earnsNetOfCredit: false,
  },
  PHONE: {
    channel: 'PHONE',
    currency: 'NONE',
    prepaidMultiplier: 0,
    payAtPropertyMultiplier: 0,
    earnsNetOfCredit: false,
  },
});

/**
 * §2.2 models OTA loyalty as "~1% cash-equivalent". An approximation cannot be
 * a constant in a product that promises auditable arithmetic, so it is pinned
 * at exactly 100 bps and exposed on `/settings/rules` where the user can see
 * and challenge it — DECISIONS.md D-013.
 */
export const OTA_LOYALTY_RATE_BPS_RULE: RuleConstant<number> = defineRule({
  key: 'OTA_LOYALTY_RATE_BPS',
  label: 'OTA loyalty value',
  description:
    'Online travel agency loyalty programmes are modelled as a flat cash-equivalent rebate ' +
    'on the total. The spec describes this as approximately 1%; it is pinned here so the ' +
    'assumption is visible rather than buried.',
  category: 'POINTS',
  value: 100,
  unit: 'bps',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/luxury-booking-showdown-fine-hotels-resorts-vs-the-edit-vs-the-reserve-vs-premier-collection/',
});

/**
 * Default point valuations — §2.5.
 *
 * These are **user-editable settings**, not fixed rules, because they are the
 * most contestable assumption in the model. §8.7's sensitivity feature exists
 * precisely to show how much a ranking depends on them.
 */
export const DEFAULT_MR_VALUE_MICRO = 15_000 as Micro; // 1.5¢
export const DEFAULT_UR_VALUE_MICRO = 17_500 as Micro; // 1.75¢

export const MR_DEFAULT_VALUE_RULE: RuleConstant<Micro> = defineRule({
  key: 'MR_DEFAULT_VALUE_MICRO',
  label: 'Membership Rewards — default valuation',
  description:
    'Default value of one Membership Rewards point, in micro-cents. 15000 = 1.5¢. ' +
    'User-editable: this is an assumption, not a fact, and the sensitivity view exists ' +
    'to show how much any given ranking depends on it.',
  category: 'POINTS',
  value: DEFAULT_MR_VALUE_MICRO,
  unit: 'micro',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/luxury-booking-showdown-fine-hotels-resorts-vs-the-edit-vs-the-reserve-vs-premier-collection/',
});

export const UR_DEFAULT_VALUE_RULE: RuleConstant<Micro> = defineRule({
  key: 'UR_DEFAULT_VALUE_MICRO',
  label: 'Ultimate Rewards — default valuation',
  description:
    'Default value of one Ultimate Rewards point, in micro-cents. 17500 = 1.75¢. ' +
    'User-editable, for the same reason as Membership Rewards.',
  category: 'POINTS',
  value: DEFAULT_UR_VALUE_MICRO,
  unit: 'micro',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/luxury-booking-showdown-fine-hotels-resorts-vs-the-edit-vs-the-reserve-vs-premier-collection/',
});

export const FHR_PAY_AT_PROPERTY_RULE: RuleConstant<number> = defineRule({
  key: 'FHR_PAY_AT_PROPERTY_MULTIPLIER',
  label: 'Fine Hotels + Resorts — pay-at-property earning rate',
  description:
    'A pay-at-property FHR booking earns 1× Membership Rewards instead of 5×. A common and ' +
    'expensive mistake, which is why the engine emits a dedicated warning for it.',
  category: 'POINTS',
  value: 1,
  unit: 'count',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.americanexpress.com/en-us/travel/faq/travel-benefits/',
});

/**
 * §3.7 / §8.7 — when points make up more than this share of the winner's
 * advantage, the win is soft and the user deserves to be told so.
 */
export const POINTS_DOMINANCE_THRESHOLD_PCT = 40;

export const POINTS_DOMINANCE_RULE: RuleConstant<number> = defineRule({
  key: 'POINTS_DOMINANCE_THRESHOLD_PCT',
  label: 'Points-dominance warning threshold',
  description:
    'When more than this percentage of the winning channel’s advantage comes from the value ' +
    'of points rather than cash, the win depends on a valuation assumption rather than money, ' +
    'and the app says so plainly.',
  category: 'POINTS',
  value: POINTS_DOMINANCE_THRESHOLD_PCT,
  unit: 'percent',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/luxury-booking-showdown-fine-hotels-resorts-vs-the-edit-vs-the-reserve-vs-premier-collection/',
});

export const POINTS_RULES = Object.freeze([
  MR_DEFAULT_VALUE_RULE,
  UR_DEFAULT_VALUE_RULE,
  OTA_LOYALTY_RATE_BPS_RULE,
  FHR_PAY_AT_PROPERTY_RULE,
  POINTS_DOMINANCE_RULE,
]);
