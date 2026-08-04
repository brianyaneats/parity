/**
 * Why claims actually get denied, as data rather than free text.
 *
 * The reason this exists: best-rate-guarantee approval rates have collapsed.
 * One long-running tally by a travel writer went from 80–90% approved in 2011
 * to under 5% by 2018 — one success in ten submissions across the major
 * chains. The denials are rarely "your rate wasn't lower". They are
 * procedural, frequently pedantic, and a meaningful share of them are simply
 * wrong: agents have rejected claims by asserting a comparison site requires
 * membership when it does not, or disputing the currency when both pages
 * showed USD.
 *
 * A free-text `denialReason` records that something went wrong. It cannot tell
 * the user *whether to push back*, and pushing back is the entire difference
 * between a 5% success rate and a recoverable one. So each reason carries:
 *
 * - `appealable` — is this worth contesting, or is the claim genuinely dead?
 * - `rebuttal` — what to actually say, when it is worth contesting.
 * - `preventable` — could a different booking or capture have avoided it?
 *
 * Sources verified 2026-08-04: The Points Guy's best-rate-guarantee reckoning
 * and FrequentMiler's per-chain guide. See DECISIONS.md D-165.
 */

export type DenialCode =
  | 'RATE_MOVED'
  | 'MEMBERSHIP_GATED'
  | 'CANCELLATION_MISMATCH'
  | 'ROOM_TYPE_MISMATCH'
  | 'OCCUPANCY_MISMATCH'
  | 'PACKAGE_INCLUSIONS_DIFFER'
  | 'NOT_LOWEST_OWN_RATE'
  | 'CURRENCY_DISPUTE'
  | 'SITE_NOT_ELIGIBLE'
  | 'DEAL_OF_THE_DAY'
  | 'WINDOW_MISSED'
  | 'FREQUENCY_LIMIT'
  | 'PROPERTY_EXCLUDED'
  | 'OTHER';

export interface DenialReasonDefinition {
  readonly code: DenialCode;
  readonly label: string;
  /** What the issuer or chain actually said, in their words. */
  readonly asStated: string;
  /** Whether contesting this is usually worth the user's time. */
  readonly appealable: boolean;
  /** What to say when contesting. Absent when the denial is legitimate. */
  readonly rebuttal?: string;
  /** What would have prevented it next time. */
  readonly preventable: string;
}

export const DENIAL_REASONS: Readonly<Record<DenialCode, DenialReasonDefinition>> = Object.freeze({
  RATE_MOVED: {
    code: 'RATE_MOVED',
    label: 'The competing rate changed before they checked',
    asStated: 'We were unable to verify the rate you submitted.',
    appealable: true,
    rebuttal:
      'A timestamped capture showing the rate at the moment you filed is the whole point of the ' +
      'evidence pack — resubmit it and ask them to assess the claim as of the filing time, not ' +
      'the review time. This is the single most common denial and the most winnable.',
    preventable:
      'File within minutes of finding the rate, not hours. Rates on the competing site move ' +
      'independently of your claim queue.',
  },
  MEMBERSHIP_GATED: {
    code: 'MEMBERSHIP_GATED',
    label: 'They say the competing rate needs a login or membership',
    asStated: 'The rate you submitted is not publicly available.',
    appealable: true,
    rebuttal:
      'Verify it yourself in a private window, signed out. Agents have asserted this about sites ' +
      'that require no account at all. If it loads signed-out, say so plainly and attach the ' +
      'signed-out capture — this denial is often simply incorrect.',
    preventable:
      'Capture the competing rate in a private window from the start, so the evidence itself ' +
      'proves no login was involved.',
  },
  CANCELLATION_MISMATCH: {
    code: 'CANCELLATION_MISMATCH',
    label: 'The cancellation policies differ',
    asStated: 'The rates are not identical in their terms and conditions.',
    appealable: false,
    preventable:
      'This is the one universal, legitimate denial across every programme — a cheaper ' +
      'non-refundable rate never qualifies against a refundable booking. Match the policy ' +
      'exactly before filing. Wording matters: "up to 1 Jan" and "before 1 Jan" have been ' +
      'treated as different policies.',
  },
  ROOM_TYPE_MISMATCH: {
    code: 'ROOM_TYPE_MISMATCH',
    label: 'The room types do not match',
    asStated: 'The room category differs from your reservation.',
    appealable: true,
    rebuttal:
      'If the descriptions differ only in wording — "king" against "standard king" — argue ' +
      'equivalence and point to the bed type, occupancy and square footage on both pages. ' +
      'If the competing room is genuinely a different category, the denial stands.',
    preventable:
      'Capture the full room description on both sides, not just the price.',
  },
  OCCUPANCY_MISMATCH: {
    code: 'OCCUPANCY_MISMATCH',
    label: 'Guest count or number of rooms differs',
    asStated: 'The reservations are not for the same party.',
    appealable: false,
    preventable:
      'Search the competing site for the same guest count you booked. A two-guest rate does not ' +
      'match a one-guest booking even at the same property on the same night.',
  },
  PACKAGE_INCLUSIONS_DIFFER: {
    code: 'PACKAGE_INCLUSIONS_DIFFER',
    label: 'One rate includes something the other does not',
    asStated: 'The rate you submitted includes additional inclusions.',
    appealable: false,
    preventable:
      'Compare room-only against room-only. A competing rate bundling breakfast, parking or ' +
      'resort credit is a different product and will never match.',
  },
  NOT_LOWEST_OWN_RATE: {
    code: 'NOT_LOWEST_OWN_RATE',
    label: 'You did not book their own lowest available rate',
    asStated: 'A lower qualifying rate was available on our site at the time of booking.',
    appealable: false,
    preventable:
      'Some programmes require you to have booked the lowest rate *they* offered, including ' +
      'member-only rates — which is not always stated up front. Sign in and take the lowest ' +
      'member rate before comparing outward.',
  },
  CURRENCY_DISPUTE: {
    code: 'CURRENCY_DISPUTE',
    label: 'They dispute the currency or conversion',
    asStated: 'The rates are quoted in different currencies.',
    appealable: true,
    rebuttal:
      'If both pages display the same currency, screenshot both currency selectors and say so. ' +
      'This has been invoked against claims where both sites showed USD. Where conversion is ' +
      'genuinely involved, some brands require a larger gap for foreign-currency claims — check ' +
      'whether you actually cleared that higher bar.',
    preventable:
      'Set both sites to your booking currency before capturing, and include the currency ' +
      'selector in the frame.',
  },
  SITE_NOT_ELIGIBLE: {
    code: 'SITE_NOT_ELIGIBLE',
    label: 'The competing site is not an eligible source',
    asStated: 'The website you submitted is not an eligible booking channel.',
    appealable: true,
    rebuttal:
      'Ask them to name the specific clause and the specific site. Eligible-site lists are ' +
      'usually defined by characteristics — publicly bookable, instant confirmation, no opaque ' +
      'pricing — rather than a published blacklist, so a bare assertion is contestable.',
    preventable:
      'Prefer well-known, publicly bookable sites with instant confirmation. Opaque or ' +
      'auction-style pricing never qualifies.',
  },
  DEAL_OF_THE_DAY: {
    code: 'DEAL_OF_THE_DAY',
    label: 'They classed the competing rate as a flash or member deal',
    asStated: 'The rate is a promotional or limited-time offer.',
    appealable: true,
    rebuttal:
      'A rate carrying a marketing badge is not automatically a restricted rate. If it was ' +
      'bookable by anyone, without a code or an account, argue that it meets the public-rate ' +
      'test and attach the signed-out capture.',
    preventable:
      'Avoid rates the competing site labels as flash sales or member specials where you can — ' +
      'they invite this denial even when they are genuinely public.',
  },
  WINDOW_MISSED: {
    code: 'WINDOW_MISSED',
    label: 'Filed outside the claim window',
    asStated: 'Claims must be submitted within the stated period.',
    appealable: false,
    preventable:
      'Every programme here runs a 24-hour clock from booking, and Hyatt additionally requires ' +
      'the claim to land at least 48 hours before check-in. Parity tracks both; file on the day ' +
      'you book.',
  },
  FREQUENCY_LIMIT: {
    code: 'FREQUENCY_LIMIT',
    label: 'You have already claimed recently under this programme',
    asStated: 'You have reached the maximum number of claims for this period.',
    appealable: false,
    preventable:
      'Wyndham allows one claim per calendar month and Best Western one per thirty days. Where ' +
      'you have a choice of programme, spend the limited one on the larger gap.',
  },
  PROPERTY_EXCLUDED: {
    code: 'PROPERTY_EXCLUDED',
    label: 'This property or brand is excluded from the programme',
    asStated: 'This property does not participate in the guarantee.',
    appealable: false,
    preventable:
      'Exclusions are specific and unintuitive — Hampton, some Ritz-Carltons, all-inclusives, ' +
      'whole regions. Check the property against the programme’s exclusions before booking, not ' +
      'after.',
  },
  OTHER: {
    code: 'OTHER',
    label: 'Something else',
    asStated: '',
    appealable: true,
    rebuttal:
      'Ask them to cite the specific clause they are relying on. A denial that cannot be traced ' +
      'to a written term is worth escalating.',
    preventable: '',
  },
});

export const DENIAL_CODES: readonly DenialCode[] = Object.freeze(
  Object.keys(DENIAL_REASONS) as DenialCode[],
);

/** The subset worth showing a "contest this" affordance for. */
export function isAppealable(code: DenialCode): boolean {
  return DENIAL_REASONS[code].appealable;
}
