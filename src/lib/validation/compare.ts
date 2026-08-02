import { z } from 'zod';
import type { BrandOrNone, Channel } from '@/domain/rules/channels.rules';

/**
 * Zod schemas shared between client and server — §5.1: "one schema per payload,
 * no duplication."
 *
 * These are the boundary §3.1 refers to when it says "percentages the user
 * types: parse to bps at the boundary; never let a float past the input layer."
 * Everything downstream of here is integer.
 */

/** A money field. Integer cents, never a float, never a string. */
const centsSchema = z
  .number({ invalid_type_error: 'must be a number of cents' })
  .int('must be a whole number of cents')
  .finite();

const nonNegativeCents = centsSchema.min(0, 'cannot be negative');

/**
 * The enum values are spelled out rather than derived from
 * `CHANNEL_RANK_ORDER`, because `z.enum()` needs a literal tuple to infer a
 * union — deriving it collapses the type to `string` and the branded `Channel`
 * is lost at the boundary, which is exactly where it matters most.
 *
 * The duplication is then made safe at compile time by `AssertNever` below: add
 * a channel to the domain without adding it here and the build fails, rather
 * than the API silently rejecting a channel the engine supports.
 */
const CHANNEL_VALUES = [
  'FHR',
  'THC',
  'EDIT',
  'CHASE_TRAVEL',
  'DIRECT_FLEX',
  'DIRECT_PREPAID',
  'OTA',
  'FORA',
  'PHONE',
] as const satisfies readonly Channel[];

const BRAND_VALUES = [
  'NONE',
  'HILTON',
  'MARRIOTT',
  'HYATT',
  'IHG',
  'WYNDHAM',
  'CHOICE',
  'BEST_WESTERN',
] as const satisfies readonly BrandOrNone[];

/** Errors unless `T` is `never`. Used to prove the lists above are exhaustive. */
type AssertNever<T extends never> = T;

// A compile error on either line means the domain gained a channel or a brand
// that the API schema cannot accept.
export type UncoveredChannel = AssertNever<Exclude<Channel, (typeof CHANNEL_VALUES)[number]>>;
export type UncoveredBrand = AssertNever<Exclude<BrandOrNone, (typeof BRAND_VALUES)[number]>>;

export const brandSchema = z.enum(BRAND_VALUES);
export const channelSchema = z.enum(CHANNEL_VALUES);

export const stayContextSchema = z.object({
  // §3.6: nights ≤ 0 is rejected here rather than defended against downstream.
  // The engine additionally throws if it is ever reached with an invalid count,
  // because a silent division by zero would put Infinity into a money figure.
  nights: z.number().int('must be a whole number of nights').min(1, 'must be at least 1'),

  // Basis points. A tax rate of 0 is legal — some jurisdictions and rate types.
  taxRateBps: z.number().int().min(0, 'cannot be negative').max(100_000, 'is implausibly high'),

  breakfastPerDayCents: nonNegativeCents,
  propertyCreditFaceCents: nonNegativeCents,
  realizationPct: z.number().int().min(0).max(100, 'is a percentage, so at most 100'),

  // Micro-cents per point. Zero is legal (§3.6) — the engine returns zero points
  // value and the sensitivity view still works.
  mrValueMicro: z.number().int().min(0),
  urValueMicro: z.number().int().min(0),

  foraRateBps: z.number().int().min(0).max(10_000),

  amexBucketAvailable: z.boolean(),
  editBucketAvailable: z.boolean(),

  // §3.6: null means "add a competing rate to check", not an error.
  competitorBaseCents: nonNegativeCents.nullable(),
  competitorRefundable: z.boolean(),
  competitorPublic: z.boolean(),

  brand: brandSchema,
});

export const channelQuoteSchema = z.object({
  channel: channelSchema,
  totalCents: nonNegativeCents,
  prepaid: z.boolean(),
  refundable: z.boolean(),
  label: z.string().trim().max(120).optional(),
});

export const compareRequestSchema = z.object({
  context: stayContextSchema,
  quotes: z
    .array(channelQuoteSchema)
    // §3.6 allows the same channel twice and forbids silent deduping, so there
    // is deliberately no uniqueness constraint here.
    .max(20, 'is more channels than a single stay can plausibly have'),
  brgOptions: z
    .object({ foreignCurrency: z.boolean().optional() })
    .optional(),
});

export type CompareRequest = z.infer<typeof compareRequestSchema>;

/**
 * The tax-rate helper from §7.3 item 3: "the user often knows base and total
 * but not the rate." Derives basis points from any two of base / tax / total.
 */
export const deriveTaxRateSchema = z
  .object({
    baseCents: nonNegativeCents.nullable().optional(),
    taxCents: nonNegativeCents.nullable().optional(),
    totalCents: nonNegativeCents.nullable().optional(),
  })
  .refine(
    (value) =>
      [value.baseCents, value.taxCents, value.totalCents].filter(
        (field) => field !== null && field !== undefined,
      ).length >= 2,
    { message: 'Provide any two of base, tax, and total.' },
  );

export type DeriveTaxRateInput = z.infer<typeof deriveTaxRateSchema>;
