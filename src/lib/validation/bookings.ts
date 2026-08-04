import { z } from 'zod';
import { channelSchema } from './compare';
import { nonNegativeCents, isoDateSchema, isoDateTimeSchema, uuidSchema } from './shared';

/** Validation for `/api/bookings` — §5.2. */

export const createBookingSchema = z.object({
  comparisonId: uuidSchema.nullable().optional(),
  channel: channelSchema,
  confirmationNumber: z.string().trim().max(120).nullable().optional(),
  bookedAt: isoDateTimeSchema,
  checkIn: isoDateSchema,
  checkOut: isoDateSchema,
  totalCents: nonNegativeCents,
  baseCents: nonNegativeCents,
  cashChargedCents: nonNegativeCents.nullable().optional(),
  pointsUsed: z.number().int().min(0).nullable().optional(),
  prepaid: z.boolean(),
  refundable: z.boolean(),
  /**
   * Who actually processed the charge. Distinct from `prepaid`, which only
   * reflects the *rate type* — a booking can be prepaid in that sense and
   * still have been charged by the property rather than the issuer, which is
   * precisely the case where the statement credit silently never posts
   * (`posting.rules.ts`). Optional: rows recorded before this existed, and
   * users who decline to say, genuinely do not know.
   */
  paymentRoute: z.enum(['PREPAID_VIA_ISSUER', 'DEPOSIT_TO_HOTEL', 'PAY_AT_PROPERTY']).optional(),
  cancelDeadline: isoDateSchema.nullable().optional(),
  bucketId: uuidSchema.nullable().optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const BOOKING_STATUS_VALUES = ['ACTIVE', 'CANCELLED', 'COMPLETED'] as const;
export const bookingStatusSchema = z.enum(BOOKING_STATUS_VALUES);

export const bookingPatchSchema = z
  .object({
    confirmationNumber: z.string().trim().max(120).nullable().optional(),
    cashChargedCents: nonNegativeCents.nullable().optional(),
    pointsUsed: z.number().int().min(0).nullable().optional(),
    bucketId: uuidSchema.nullable().optional(),
    status: bookingStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type BookingPatchInput = z.infer<typeof bookingPatchSchema>;
