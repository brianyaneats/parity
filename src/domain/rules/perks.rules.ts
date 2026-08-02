import { defineRule, VERIFIED_ON, type RuleConstant } from './rule-types';
import type { Cents } from '../shared/cents';

/**
 * Perks valuation — §2.6.
 *
 * ```
 * breakfast = breakfastPerDay × nights      // only when channel.grantsPortalPerks
 * property  = propertyCreditFace × realizationPct / 100
 * perks     = breakfast + property
 * ```
 *
 * The default breakfast figure is **$70, not the $100+ menu price**. The value
 * of a perk is what the user would otherwise have *paid*, not what the hotel
 * charges. Amex markets FHR at "$550 average value on a 2-night stay"; §2.6
 * bans marketing valuations anywhere in this product, and §13.3 warns that
 * inflated perk values are the easiest way to make this app produce nonsense.
 */

export const DEFAULT_BREAKFAST_PER_DAY_CENTS = 7_000 as Cents;
export const DEFAULT_PROPERTY_CREDIT_FACE_CENTS = 10_000 as Cents;
export const DEFAULT_REALIZATION_PCT = 100;

export const BREAKFAST_VALUE_RULE: RuleConstant<Cents> = defineRule({
  key: 'BREAKFAST_PER_DAY_CENTS',
  label: 'Breakfast for two — default daily value',
  description:
    'What you would otherwise have paid for breakfast, not the menu price. Defaulted to $70 ' +
    'rather than the $100+ a luxury hotel charges, because the perk is worth what it saves ' +
    'you, not what it is priced at. User-editable per comparison.',
  category: 'PERKS',
  value: DEFAULT_BREAKFAST_PER_DAY_CENTS,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.americanexpress.com/en-us/travel/faq/travel-benefits/',
});

export const PROPERTY_CREDIT_FACE_RULE: RuleConstant<Cents> = defineRule({
  key: 'PROPERTY_CREDIT_FACE_CENTS',
  label: 'On-property credit — default face value',
  description:
    'The typical on-property credit granted by Fine Hotels + Resorts, The Hotel Collection ' +
    'and The Edit. Overridden per property from seeded data where the real figure is known.',
  category: 'PERKS',
  value: DEFAULT_PROPERTY_CREDIT_FACE_CENTS,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.chase.com/travel/guide/hotels/the-edit-chase-travel-credits-benefits',
});

export const REALIZATION_RULE: RuleConstant<number> = defineRule({
  key: 'DEFAULT_REALIZATION_PCT',
  label: 'Property credit realization rate',
  description:
    'The fraction of an on-property credit you will genuinely spend. A dining credit at a ' +
    'hotel where you will eat is 100%; a spa-only credit for someone who will not use the spa ' +
    'is closer to 20%. Editable per stay.',
  category: 'PERKS',
  value: DEFAULT_REALIZATION_PCT,
  unit: 'percent',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.americanexpress.com/en-us/travel/benefits/how-to-use-hotel-credit',
});

/** Kinds of on-property credit, which drive the realization hint in the UI. */
export type PropertyCreditKind = 'DINING' | 'SPA' | 'RESORT' | 'ANY';

export const PROPERTY_CREDIT_KIND_HINTS: Readonly<Record<PropertyCreditKind, string>> =
  Object.freeze({
    DINING: 'Dining credit — usually spent in full if you eat at the hotel once.',
    SPA: 'Spa-only credit — worth far less than face unless you already planned a treatment.',
    RESORT: 'Resort credit — check what it actually covers before valuing it at 100%.',
    ANY: 'Flexible credit — usually realised in full.',
  });

export const PERKS_RULES = Object.freeze([
  BREAKFAST_VALUE_RULE,
  PROPERTY_CREDIT_FACE_RULE,
  REALIZATION_RULE,
]);
