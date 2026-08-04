import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { ClaimQueue, type ClaimQueueRow } from '@/features/claims/ClaimQueue';

export const metadata = { title: 'Claims · Parity' };

/**
 * `/claims` — the claim queue (§7.4).
 *
 * §1.3: "most of the value is in the collection, not the comparison." This
 * screen is that value — it exists to make sure the 24-hour price-match
 * window (§1.5's second success criterion) is never missed.
 *
 * Data is loaded server-side, in a try/catch, mirroring `/compare`'s
 * fallback discipline (`src/app/(app)/compare/page.tsx`). Unlike `/compare`,
 * there is no seed data that could plausibly stand in for "your real claims"
 * — a fabricated claim would be actively misleading — so a database failure
 * surfaces as `ClaimQueue`'s genuine error state (with a retry) rather than
 * being silently swallowed into an empty list. The empty *and* error states
 * both matter here: the database is unseeded in dev, so the empty state is
 * what will actually render, and it needs to say something useful rather
 * than just "nothing here."
 */
export default async function ClaimsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { rows, error } = await loadClaimQueue(session.userId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-h1 text-text-primary">Claims</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Sorted by deadline. Anything inside its last 24 hours is pinned to the top with a live countdown.
        </p>
      </div>
      <ClaimQueue rows={rows} error={error} />
    </div>
  );
}

async function loadClaimQueue(userId: string): Promise<{ rows: readonly ClaimQueueRow[]; error?: string }> {
  try {
    const [{ db }, schema, drizzleOrm] = await Promise.all([
      import('@/infrastructure/persistence/db'),
      import('@/infrastructure/persistence/schema'),
      import('drizzle-orm'),
    ]);

    const { claims, bookings, comparisons } = schema;
    const { eq, asc } = drizzleOrm;

    const rows = await db
      .select({
        id: claims.id,
        status: claims.status,
        deadlineAt: claims.deadlineAt,
        claimedGapCents: claims.claimedGapCents,
        awardedCents: claims.awardedCents,
        bookedAt: bookings.bookedAt,
        propertyName: comparisons.propertyNameSnapshot,
      })
      .from(claims)
      .innerJoin(bookings, eq(claims.bookingId, bookings.id))
      .leftJoin(comparisons, eq(bookings.comparisonId, comparisons.id))
      // Never a conditional filter here: Drizzle treats `undefined` as "no
      // WHERE at all," which once made the logged-out view a list of every
      // user's claims. The page guarantees a session before this runs.
      .where(eq(claims.userId, userId))
      .orderBy(asc(claims.deadlineAt))
      .limit(200);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        propertyName: row.propertyName ?? 'Unlinked booking',
        bookedAt: row.bookedAt.toISOString(),
        deadlineAt: row.deadlineAt.toISOString(),
        status: row.status,
        gapCents: row.claimedGapCents,
        awardedCents: row.awardedCents,
      })),
    };
  } catch {
    return { rows: [], error: "Couldn't load claims. The database may be unreachable." };
  }
}
