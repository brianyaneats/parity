import { defineRule, VERIFIED_ON, type RuleConstant } from './rule-types';

/**
 * The channel catalog — §2.2.
 *
 * Nine channels, not eight. The prose in §2.2 says "Eight channels" but its own
 * table and the `Channel` union in §3.2 both enumerate nine. See DECISIONS.md
 * D-001.
 */
export type Channel =
  | 'FHR'
  | 'THC'
  | 'EDIT'
  | 'CHASE_TRAVEL'
  | 'DIRECT_FLEX'
  | 'DIRECT_PREPAID'
  | 'OTA'
  | 'FORA'
  | 'PHONE';

export type ChainBrand =
  | 'HILTON'
  | 'MARRIOTT'
  | 'HYATT'
  | 'IHG'
  | 'WYNDHAM'
  | 'CHOICE'
  | 'BEST_WESTERN'
  | 'ACCOR';

export type BrandOrNone = ChainBrand | 'NONE';

export interface ChannelDefinition {
  readonly channel: Channel;
  readonly label: string;
  /** Short line under the name in the ranked list — §8.1's row grammar. */
  readonly sublabel: string;
  /** Breakfast for two plus the on-property credit — §2.2. */
  readonly grantsPortalPerks: boolean;
  /** Whether the issuer's own price-match programme can be claimed against it. */
  readonly priceMatchable: boolean;
  /** A chain best-rate guarantee requires booking direct — §2.3.3. */
  readonly brgEligible: boolean;
  /** Whether the channel is normally prepaid. Advisory only; the quote decides. */
  readonly typicallyPrepaid: boolean;
}

/**
 * Ranking tie-break (c) in §3.4 is "channel enum order as listed in §2.2".
 * Declared as an explicit ordered array rather than relying on object key or
 * union member order, neither of which is a stable contract — DECISIONS.md D-018.
 */
export const CHANNEL_RANK_ORDER: readonly Channel[] = Object.freeze([
  'FHR',
  'THC',
  'EDIT',
  'CHASE_TRAVEL',
  'DIRECT_FLEX',
  'DIRECT_PREPAID',
  'OTA',
  'FORA',
  'PHONE',
]);

export const CHANNEL_DEFINITIONS: Readonly<Record<Channel, ChannelDefinition>> = Object.freeze({
  FHR: {
    channel: 'FHR',
    label: 'Amex Fine Hotels + Resorts',
    sublabel: 'Portal perks · no price-match backstop',
    grantsPortalPerks: true,
    priceMatchable: false,
    brgEligible: false,
    typicallyPrepaid: true,
  },
  THC: {
    channel: 'THC',
    label: 'Amex The Hotel Collection',
    sublabel: 'Portal perks · 2-night minimum for the credit',
    grantsPortalPerks: true,
    priceMatchable: false,
    brgEligible: false,
    typicallyPrepaid: true,
  },
  EDIT: {
    channel: 'EDIT',
    label: 'Chase The Edit',
    sublabel: 'Portal perks · price-matchable',
    grantsPortalPerks: true,
    priceMatchable: true,
    brgEligible: false,
    typicallyPrepaid: true,
  },
  CHASE_TRAVEL: {
    channel: 'CHASE_TRAVEL',
    label: 'Chase Travel',
    sublabel: 'Price-matchable · no portal perks',
    grantsPortalPerks: false,
    priceMatchable: true,
    brgEligible: false,
    typicallyPrepaid: true,
  },
  DIRECT_FLEX: {
    channel: 'DIRECT_FLEX',
    label: 'Hotel direct — flexible',
    sublabel: 'Chain points and elite nights · best-rate-guarantee eligible',
    grantsPortalPerks: false,
    priceMatchable: false,
    brgEligible: true,
    typicallyPrepaid: false,
  },
  DIRECT_PREPAID: {
    channel: 'DIRECT_PREPAID',
    label: 'Hotel direct — advance purchase',
    sublabel: 'Chain points and elite nights · non-refundable',
    grantsPortalPerks: false,
    priceMatchable: false,
    brgEligible: false,
    typicallyPrepaid: true,
  },
  OTA: {
    channel: 'OTA',
    label: 'Online travel agency',
    sublabel: 'No perks, no credits, no elite nights',
    grantsPortalPerks: false,
    priceMatchable: false,
    brgEligible: false,
    typicallyPrepaid: true,
  },
  FORA: {
    channel: 'FORA',
    label: 'Fora advisor (self-booked)',
    sublabel: 'Post-stay rebate · cannot use portal credits',
    grantsPortalPerks: false,
    priceMatchable: false,
    brgEligible: false,
    typicallyPrepaid: false,
  },
  PHONE: {
    channel: 'PHONE',
    label: 'Negotiated by phone',
    sublabel: 'Manually entered quote',
    grantsPortalPerks: false,
    priceMatchable: false,
    brgEligible: false,
    typicallyPrepaid: false,
  },
});

/** The three channels that grant breakfast plus the on-property credit — §2.2. */
export const PERK_GRANTING_CHANNELS: ReadonlySet<Channel> = Object.freeze(
  new Set<Channel>(
    CHANNEL_RANK_ORDER.filter((c) => CHANNEL_DEFINITIONS[c].grantsPortalPerks),
  ),
);

/**
 * The channels Chase's price match can reach — §2.3.1 PM2.
 *
 * The Edit is in here. Chase confirmed it, and leaving it out would silently
 * delete the product's best feature. Fixture TC-06 exists to prove the converse:
 * that Amex channels are *not* in here.
 */
export const PRICE_MATCHABLE_CHANNELS: ReadonlySet<Channel> = Object.freeze(
  new Set<Channel>(CHANNEL_RANK_ORDER.filter((c) => CHANNEL_DEFINITIONS[c].priceMatchable)),
);

export function isChannel(value: string): value is Channel {
  return (CHANNEL_RANK_ORDER as readonly string[]).includes(value);
}

export const CHANNEL_CATALOG_RULE: RuleConstant<number> = defineRule({
  key: 'CHANNEL_COUNT',
  label: 'Channels modelled',
  description:
    'Distinct ways of booking the same room that Parity ranks against each other. ' +
    'The spec prose says eight; its own table and type definition both list nine.',
  category: 'CHANNEL',
  value: CHANNEL_RANK_ORDER.length,
  unit: 'count',
  verifiedOn: VERIFIED_ON,
  sourceUrl: 'https://frequentmiler.com/luxury-booking-showdown-fine-hotels-resorts-vs-the-edit-vs-the-reserve-vs-premier-collection/',
});
