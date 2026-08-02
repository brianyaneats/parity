import { z } from 'zod';
import { nonNegativeCents, uuidSchema, isoDateTimeSchema } from './shared';

/** Validation for `/api/buckets` — §5.2, §2.4. */

export const consumeBucketSchema = z.object({
  bucketId: uuidSchema,
  amountCents: nonNegativeCents.min(1, 'must consume a positive amount'),
  occurredAt: isoDateTimeSchema.optional(),
  bookingId: uuidSchema.optional(),
});

export type ConsumeBucketInput = z.infer<typeof consumeBucketSchema>;
