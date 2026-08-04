'use server';

import { z } from 'zod';
import { getSession } from '@/lib/auth/session';

/**
 * Server actions backing `/credits`' "did it actually post?" section — the
 * write side of `src/domain/credit/CreditPosting.ts`. Modelled on
 * `src/features/compare/onboardingActions.ts` (dynamic imports of `db`/
 * `schema` inside a `try/catch`, so an unreachable database degrades to a
 * message instead of a framework error overlay) and on
 * `src/features/settings/actions.ts` for the zod-then-session-then-write
 * shape every action here follows.
 *
 * Every write is scoped by `session.userId` in its own `WHERE` clause, never
 * by an id the client supplies alone — `postingId` (or `bucketId`/
 * `bookingId` on `recordPosting`) identifies *which* row, `session.userId`
 * (resolved server-side from the signed cookie, never accepted as an
 * argument) identifies *whose*. A mark-posted/mark-missing call against a
 * `postingId` that exists but belongs to someone else updates zero rows
 * rather than someone else's credit.
 */

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export type RecordPostingResult =
  | { readonly ok: true; readonly postingId: string }
  | { readonly ok: false; readonly message: string };

const uuidSchema = z.string().uuid('must be a valid id');
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date');
const centsSchema = z.number().int('must be a whole number of cents').min(0);

const markPostedInputSchema = z.object({
  postingId: uuidSchema,
  postedCents: centsSchema,
  postedOn: isoDateSchema,
});

/**
 * Records that the credit actually landed. `postedCents` is what the issuer
 * paid, not necessarily `expectedCents` — a partial post is still a post, and
 * the gap between the two is left visible on the row rather than silently
 * reconciled to the expected figure.
 */
export async function markPosted(
  postingId: string,
  postedCents: number,
  postedOn: string,
): Promise<ActionResult> {
  const parsed = markPostedInputSchema.safeParse({ postingId, postedCents, postedOn });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Some values need fixing.' };
  }

  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to update this credit.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { creditPostings } = await import('@/infrastructure/persistence/schema');
    const { and, eq } = await import('drizzle-orm');

    const updated = await db
      .update(creditPostings)
      .set({
        status: 'POSTED',
        postedCents: parsed.data.postedCents,
        postedOn: parsed.data.postedOn,
        updatedAt: new Date(),
      })
      .where(and(eq(creditPostings.id, parsed.data.postingId), eq(creditPostings.userId, session.userId)))
      .returning({ id: creditPostings.id });

    if (updated.length === 0) {
      return { ok: false, message: 'This credit could not be found.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the database. This credit was not updated — try again shortly.' };
  }
}

const markMissingInputSchema = z.object({ postingId: uuidSchema });

/**
 * Flags a credit as checked-and-not-there. Deliberately does not stop the
 * settling/overdue/stale clock (`CreditPosting.classifyPosting` bands `MISSING`
 * the same as `PENDING`) — this records that the user looked once, not that
 * the case is closed.
 */
export async function markMissing(postingId: string): Promise<ActionResult> {
  const parsed = markMissingInputSchema.safeParse({ postingId });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Some values need fixing.' };
  }

  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to update this credit.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { creditPostings } = await import('@/infrastructure/persistence/schema');
    const { and, eq } = await import('drizzle-orm');

    const updated = await db
      .update(creditPostings)
      .set({ status: 'MISSING', updatedAt: new Date() })
      .where(and(eq(creditPostings.id, parsed.data.postingId), eq(creditPostings.userId, session.userId)))
      .returning({ id: creditPostings.id });

    if (updated.length === 0) {
      return { ok: false, message: 'This credit could not be found.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not reach the database. This credit was not updated — try again shortly.' };
  }
}

const recordPostingInputSchema = z.object({
  bucketId: uuidSchema.nullish(),
  bookingId: uuidSchema.nullish(),
  expectedCents: centsSchema,
  chargedOn: isoDateSchema,
  merchantDescriptor: z.string().trim().max(200).nullish(),
});

export type RecordPostingInput = z.infer<typeof recordPostingInputSchema>;

/**
 * Starts tracking a new expected credit — the entry point for "log one by
 * hand" (§ table doc comment in `schema.ts`: "a credit can exist with no
 * booking behind it at all once a user logs one by hand"). Starts `PENDING`;
 * `CreditPosting.classifyPosting` takes it from there.
 *
 * `bucketId`/`bookingId`, if given, are verified to belong to the caller
 * before the insert — accepting either at face value would let one signed-in
 * user attach their new posting to *another* user's bucket or booking id,
 * which is exactly the kind of client-supplied-scope bug §12's `userId`
 * discipline exists to rule out everywhere else in this app.
 */
export async function recordPosting(input: RecordPostingInput): Promise<RecordPostingResult> {
  const parsed = recordPostingInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Some values need fixing.' };
  }

  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in to track a credit.' };

  try {
    const { db } = await import('@/infrastructure/persistence/db');
    const { creditPostings, creditBuckets, bookings } = await import('@/infrastructure/persistence/schema');
    const { and, eq } = await import('drizzle-orm');

    const { bucketId, bookingId, expectedCents, chargedOn, merchantDescriptor } = parsed.data;

    if (bucketId) {
      const [owned] = await db
        .select({ id: creditBuckets.id })
        .from(creditBuckets)
        .where(and(eq(creditBuckets.id, bucketId), eq(creditBuckets.userId, session.userId)))
        .limit(1);
      if (!owned) return { ok: false, message: 'That bucket could not be found.' };
    }

    if (bookingId) {
      const [owned] = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.userId, session.userId)))
        .limit(1);
      if (!owned) return { ok: false, message: 'That booking could not be found.' };
    }

    const [created] = await db
      .insert(creditPostings)
      .values({
        userId: session.userId,
        bucketId: bucketId ?? null,
        bookingId: bookingId ?? null,
        expectedCents,
        chargedOn,
        merchantDescriptor: merchantDescriptor ?? null,
        status: 'PENDING',
      })
      .returning({ id: creditPostings.id });

    if (!created) {
      return { ok: false, message: 'Could not reach the database. This credit was not saved — try again shortly.' };
    }
    return { ok: true, postingId: created.id };
  } catch {
    return { ok: false, message: 'Could not reach the database. This credit was not saved — try again shortly.' };
  }
}
