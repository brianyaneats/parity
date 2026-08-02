import { z } from 'zod';

/**
 * Small validation helpers shared across the new route schemas — the same
 * house style as `src/lib/validation/compare.ts` (money is integer cents,
 * parsed and branded at the boundary — §3.1), factored out so every new
 * schema file doesn't redefine `centsSchema` from scratch.
 */

export const centsSchema = z
  .number({ invalid_type_error: 'must be a number of cents' })
  .int('must be a whole number of cents')
  .finite();

export const nonNegativeCents = centsSchema.min(0, 'cannot be negative');

/** `YYYY-MM-DD`, matching every `date` column in §4.2's schema. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD form');

/** Anything `new Date(...)` can parse into a real instant — for `timestamptz` inputs. */
export const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'must be a valid date-time',
});

export const uuidSchema = z.string().uuid();

/** Opaque pagination cursor — see `encodeCursor`/`decodeCursor` in the comparisons repository. */
export const cursorSchema = z.string().min(1).max(500).optional();

export const limitSchema = z.coerce.number().int().min(1).max(100).optional();

/**
 * Parses `URLSearchParams` against a Zod object schema. Every field arrives as
 * a string (or is absent), so schemas passed here should use `z.coerce.*` or
 * `z.enum` rather than `z.number()`/`z.boolean()` directly.
 */
export function parseQuery<T extends z.ZodTypeAny>(schema: T, searchParams: URLSearchParams): z.infer<T> {
  const raw: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) raw[key] = value;
  return schema.parse(raw);
}
