import { z } from 'zod';
import { stayContextSchema, channelQuoteSchema, channelSchema } from './compare';
import { nonNegativeCents, isoDateSchema, isoDateTimeSchema, uuidSchema } from './shared';

/**
 * Validation for `/api/comparisons` — §5.2.
 *
 * Reuses `stayContextSchema`/`channelQuoteSchema`/`channelSchema` from
 * `compare.ts` rather than redeclaring them (§5.1: "one schema per payload, no
 * duplication") — a comparison is persisted *from* exactly the same
 * `{ context, quotes }` shape `POST /api/compare` already validates, plus the
 * trip/property/date metadata that only matters once something is saved.
 */

export const COMPARISON_STATUS_VALUES = ['DRAFT', 'DECIDED', 'BOOKED', 'ABANDONED'] as const;
export const comparisonStatusSchema = z.enum(COMPARISON_STATUS_VALUES);

const competingRateInputSchema = z.object({
  siteDomain: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2000),
  baseCents: nonNegativeCents,
  taxCents: nonNegativeCents.nullable().optional(),
  refundable: z.boolean(),
  publiclyAvailable: z.boolean(),
  roomType: z.string().trim().max(120).nullable().optional(),
  bedType: z.string().trim().max(120).nullable().optional(),
  adults: z.number().int().min(0).max(20).nullable().optional(),
  children: z.number().int().min(0).max(20).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  capturedAt: isoDateTimeSchema.optional(),
});

export const createComparisonSchema = z.object({
  tripId: uuidSchema.nullable().optional(),
  propertyId: uuidSchema.nullable().optional(),
  propertyNameSnapshot: z.string().trim().min(1, 'is required').max(200),
  checkIn: isoDateSchema,
  checkOut: isoDateSchema,
  adults: z.number().int().min(1).max(20).optional(),
  children: z.number().int().min(0).max(20).optional(),
  rooms: z.number().int().min(1).max(20).optional(),
  roomType: z.string().trim().max(120).nullable().optional(),
  bedType: z.string().trim().max(120).nullable().optional(),
  currency: z.string().length(3).optional(),
  context: stayContextSchema,
  quotes: z.array(channelQuoteSchema).max(20),
  competingRate: competingRateInputSchema.optional(),
  status: comparisonStatusSchema.optional(),
  chosenChannel: channelSchema.nullable().optional(),
});

export type CreateComparisonInput = z.infer<typeof createComparisonSchema>;

export const comparisonPatchSchema = z
  .object({
    status: comparisonStatusSchema.optional(),
    chosenChannel: channelSchema.nullable().optional(),
    tripId: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type ComparisonPatchInput = z.infer<typeof comparisonPatchSchema>;

export const comparisonListQuerySchema = z.object({
  tripId: uuidSchema.optional(),
  status: comparisonStatusSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ComparisonListQuery = z.infer<typeof comparisonListQuerySchema>;
