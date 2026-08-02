import { z } from 'zod';
import { isoDateSchema } from './shared';

/** Validation for `GET /api/ledger` — §5.2. */

export const ledgerQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  // Query strings are always text; `"true"`/`"false"` map to a real boolean,
  // anything else is a validation error rather than a silently-ignored filter.
  realized: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
