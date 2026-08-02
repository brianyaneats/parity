'use server';

import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import type { BrandOrNone } from '@/domain/rules/channels.rules';
import type { PropertyCreditKind } from '@/domain/rules/perks.rules';

/**
 * Server action backing the `/properties` inline editor — §7.8, §8.5.
 *
 * "The user's own edits shadow seeds rather than mutating them." A seed row
 * has `properties.user_id = NULL`; this action never writes to one. It always
 * targets the *current user's own* row for that property name — updating it
 * if one already exists (so re-editing doesn't pile up duplicate overrides),
 * otherwise inserting a fresh one — which is exactly the shadow `listProperties`
 * already knows how to resolve (a non-null `userId` row wins over the null-
 * owned seed of the same name, case-insensitively).
 *
 * Lives in `src/features/properties/**` rather than a new `src/app/api/**`
 * route: a Server Action needs no route file, and this feature's write
 * surface is this path, not `src/app/api/**`.
 */

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

const CREDIT_KIND_VALUES = ['DINING', 'SPA', 'RESORT', 'ANY'] as const satisfies readonly PropertyCreditKind[];

const overrideInputSchema = z.object({
  // The shadow key. Matched case-insensitively against the seed's own name —
  // see `listProperties` — so this must be the exact display name, not an id
  // (a seed's id is synthetic in the DB-unreachable fallback and would not
  // resolve to anything in the properties table anyway).
  name: z.string().trim().min(1, 'is required').max(200),
  city: z.string().trim().max(120).nullable(),
  brand: z.enum(BRAND_VALUES),
  inFhr: z.boolean(),
  inThc: z.boolean(),
  inEdit: z.boolean(),
  propertyCreditFaceCents: z.number().int('must be a whole number of cents').min(0),
  propertyCreditKind: z.enum(CREDIT_KIND_VALUES),
});

export type PropertyOverrideInput = z.infer<typeof overrideInputSchema>;

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export async function savePropertyOverride(input: PropertyOverrideInput): Promise<ActionResult> {
  const parsed = overrideInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Some values need fixing before this can be saved.' };
  }

  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to save your own property overrides.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { properties } = await import('@/infrastructure/persistence/schema');
    const { and, eq, sql } = await import('drizzle-orm');

    const { name, city, ...rest } = parsed.data;

    const existing = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.userId, session.userId), sql`lower(${properties.name}) = lower(${name})`))
      .limit(1);

    const values = { userId: session.userId, name, city, ...rest };
    const existingRow = existing[0];

    if (existingRow) {
      await db.update(properties).set(values).where(eq(properties.id, existingRow.id));
    } else {
      await db.insert(properties).values(values);
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      message: 'Could not reach the database. Your change was not saved — try again shortly.',
    };
  }
}
