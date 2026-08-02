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
