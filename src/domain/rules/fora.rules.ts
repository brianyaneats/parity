import { defineRule, VERIFIED_ON, type RuleConstant } from './rule-types';
import type { Cents } from '../shared/cents';

/**
 * Fora self-commission — §2.7.
 *
 * Hotels pay roughly 10% commission; Fora's split is 70/30 in the advisor's
 * favour, so about **7% net** to a self-booking advisor.
 *
 * The important product point is not the arithmetic, it is the label: this is a
 * **post-stay rebate, not a discount**. It arrives weeks to months after
 * checkout, around the 15th and 30th of the month following the stay. Showing
 * it as a discount would overstate the immediate cash position of a Fora
 * booking, so the UI is required to name the timing wherever the figure appears.
 */

export const DEFAULT_FORA_RATE_BPS = 700;

export const FORA_RATE_RULE: RuleConstant<number> = defineRule({
  key: 'FORA_RATE_BPS',
  label: 'Fora advisor net commission',
  description:
    'Hotels pay roughly 10% commission and Fora splits it 70/30 in the advisor’s favour, ' +
    'netting about 7% of the total. Paid after checkout, not at booking.',
  category: 'REBATE',
  value: DEFAULT_FORA_RATE_BPS,
  unit: 'bps',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.foratravel.com/join/faq',
});

export const FORA_MEMBERSHIP_QUARTERLY_CENTS = 9_900 as Cents;
export const FORA_MEMBERSHIP_ANNUAL_CENTS = 29_900 as Cents;

export const FORA_MEMBERSHIP_RULE: RuleConstant<Cents> = defineRule({
  key: 'FORA_MEMBERSHIP_ANNUAL_CENTS',
  label: 'Fora membership cost',
  description:
    '$99 per quarter or $299 per year. Not deducted from any individual comparison, but it ' +
    'sets the annual booking volume at which Fora self-booking starts paying for itself.',
  category: 'REBATE',
  value: FORA_MEMBERSHIP_ANNUAL_CENTS,
  unit: 'cents',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.foratravel.com/join/faq',
});

/**
 * §2.7: Fora bookings cannot use portal statement credits and are not
 * price-matchable. Both facts already fall out of the channel catalog and the
 * credit face table; this constant exists so the rules screen states it
 * explicitly rather than leaving the user to infer it.
 */
export const FORA_NO_PORTAL_CREDITS_RULE: RuleConstant<boolean> = defineRule({
  key: 'FORA_NO_PORTAL_CREDITS',
  label: 'Fora bookings cannot use portal credits',
  description:
    'A Fora booking is not a portal booking, so it unlocks no Amex or Chase statement credit ' +
    'and cannot be price matched by either issuer.',
  category: 'REBATE',
  value: true,
  unit: 'boolean',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://www.foratravel.com/join/faq',
});

export const FORA_PAYOUT_DESCRIPTION =
  'Paid after checkout, typically around the 15th and 30th of the following month.';

export const FORA_RULES = Object.freeze([
  FORA_RATE_RULE,
  FORA_MEMBERSHIP_RULE,
  FORA_NO_PORTAL_CREDITS_RULE,
]);
