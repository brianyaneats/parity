import { defineRule, type RuleConstant } from './rule-types';

/**
 * Statement credits after the charge — the half of the loop the rest of this
 * app assumed away.
 *
 * Every other rule here answers "will this booking *earn* the credit?".
 * These answer "did the credit actually *arrive*?", which is a genuinely
 * different question and, judging by where cardholders actually lose money,
 * the one that goes unanswered. Two documented failure modes:
 *
 * 1. **It never posts.** Several Amex benefits require enrolment *before* the
 *    purchase; buy first and the credit is simply forfeit. Others fail on the
 *    issuer's side — a 2024 FHR fault withheld the $200 credit and 5× points
 *    from a whole cohort of bookings, with Amex quoting an 8–10 week fix.
 *    Nothing tells the cardholder; the money just never appears.
 * 2. **It posts late enough to look like never.** Observed posting lag for the
 *    same benefit ranged from same-day to twelve days. Without a normal
 *    baseline there is no moment at which a rational person starts chasing,
 *    so most people never do.
 *
 * The product answer is a settling period, then a nudge with the exact three
 * facts the issuer's chat asks for (merchant, amount, charge date). See
 * DECISIONS.md D-164.
 *
 * Verified 2026-08-04 against The Points Guy's missing-credits guide and
 * FrequentMiler's FHR reporting.
 */

const POSTING_VERIFIED_ON = '2026-08-04';

/**
 * How long a credit is allowed to be "in flight" before Parity calls it
 * overdue. Deliberately past the longest *normal* lag observed (12 days)
 * rather than at it: a nudge that fires while the credit is still merely slow
 * teaches the user to ignore nudges.
 */
export const CREDIT_POSTING_SETTLING_DAYS = 14;

/**
 * Past this, a missing credit is very unlikely to arrive on its own and the
 * cardholder should be filing, not waiting. Chosen as the outer edge of the
 * issuer-side outage window Amex itself quoted (8–10 weeks) — beyond it,
 * "wait longer" stops being advice and starts being how the money is lost.
 */
export const CREDIT_POSTING_ABANDON_DAYS = 70;

export const CREDIT_POSTING_SETTLING_RULE: RuleConstant<number> = defineRule({
  key: 'CREDIT_POSTING_SETTLING_DAYS',
  label: 'Statement credit — settling period before a credit counts as overdue',
  description:
    'Observed posting lag for the same benefit has ranged from same-day to twelve days. ' +
    'Parity waits this long after the charge before flagging a credit as missing, so the ' +
    'prompt means "this is now abnormal" rather than "this is not instant".',
  category: 'STATEMENT_CREDIT',
  value: CREDIT_POSTING_SETTLING_DAYS,
  unit: 'count',
  verifiedOn: POSTING_VERIFIED_ON,
  sourceUrl:
    'https://thepointsguy.com/credit-cards/american-express/claim-missing-amex-statement-credits',
});

export const CREDIT_POSTING_ABANDON_RULE: RuleConstant<number> = defineRule({
  key: 'CREDIT_POSTING_ABANDON_DAYS',
  label: 'Statement credit — point at which a missing credit needs escalation, not patience',
  description:
    'The outer edge of the issuer-side outage window Amex quoted during the 2024 Fine Hotels ' +
    'fault (8–10 weeks). Past this a credit is very unlikely to post unaided.',
  category: 'STATEMENT_CREDIT',
  value: CREDIT_POSTING_ABANDON_DAYS,
  unit: 'count',
  verifiedOn: POSTING_VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/amex-fine-hotels-resorts-guide/',
});

/**
 * How the stay was actually paid for — the distinction that decides whether a
 * portal statement credit can trigger at all.
 *
 * A cardholder who clicks "Pay Now" believes they prepaid. Whether the credit
 * posts depends on *who took the money*: only a charge processed by the issuer's
 * own travel arm counts. A deposit collected by the property, or settlement at
 * the desk, leaves the issuer with no qualifying charge to match against — and
 * some properties advertise "Pay Now" while charging the hotel directly, so the
 * booking flow itself does not reliably reveal which happened.
 */
export type PaymentRoute = 'PREPAID_VIA_ISSUER' | 'DEPOSIT_TO_HOTEL' | 'PAY_AT_PROPERTY';

export interface PaymentRouteDefinition {
  readonly route: PaymentRoute;
  readonly label: string;
  /** Whether a portal statement credit can post against a charge routed this way. */
  readonly earnsPortalCredit: boolean;
  /** Shown when this route forfeits a credit the booking would otherwise earn. */
  readonly warning?: string;
  readonly remedy?: string;
}

export const PAYMENT_ROUTES: Readonly<Record<PaymentRoute, PaymentRouteDefinition>> = Object.freeze({
  PREPAID_VIA_ISSUER: {
    route: 'PREPAID_VIA_ISSUER',
    label: 'Prepaid — the issuer’s travel portal charged my card',
    earnsPortalCredit: true,
  },
  DEPOSIT_TO_HOTEL: {
    route: 'DEPOSIT_TO_HOTEL',
    label: 'Deposit — the property charged my card directly',
    earnsPortalCredit: false,
    warning:
      'A deposit taken by the property is not a portal charge, so the statement credit will not post — ' +
      'even though the booking looks prepaid and the money has already left your account.',
    remedy:
      'Call the issuer’s travel line and ask them to rebook it as a genuine prepaid reservation. ' +
      'Agents can usually do this even when the website offers only a deposit.',
  },
  PAY_AT_PROPERTY: {
    route: 'PAY_AT_PROPERTY',
    label: 'Paying at the property on check-out',
    earnsPortalCredit: false,
    warning:
      'Settling at the desk gives the issuer no charge to match, so the statement credit will not post.',
    remedy:
      'Call the issuer’s travel line before you travel and ask to convert this to a prepaid booking.',
  },
});

export const PORTAL_CREDIT_REQUIRES_ISSUER_CHARGE_RULE: RuleConstant<boolean> = defineRule({
  key: 'PORTAL_CREDIT_REQUIRES_ISSUER_CHARGE',
  label: 'Portal statement credits require a charge processed by the issuer',
  description:
    'A deposit collected by the property, or payment at check-out, does not trigger the portal ' +
    'statement credit — the issuer never processes a qualifying charge. Properties sometimes ' +
    'present this as "Pay Now", so the booking screen cannot be trusted to distinguish them.',
  category: 'STATEMENT_CREDIT',
  value: true,
  unit: 'boolean',
  verifiedOn: POSTING_VERIFIED_ON,
  sourceUrl:
    'https://frequentmiler.com/amex-200-fine-hotels-and-resorts-credit-what-to-do-if-you-cant-prepay-hint-dont-leave-a-deposit/',
});

export const POSTING_RULES = Object.freeze([
  CREDIT_POSTING_SETTLING_RULE,
  CREDIT_POSTING_ABANDON_RULE,
  PORTAL_CREDIT_REQUIRES_ISSUER_CHARGE_RULE,
]);
