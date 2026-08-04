import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { EmptyState } from '@/components/ui';
import { ClaimKit, type ClaimKitData } from '@/features/claims/ClaimKit';

export const metadata = { title: 'Claim kit · Parity' };

type LoadResult =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ok'; readonly data: ClaimKitData };

/**
 * `/claims/[id]` — the claim kit (§7.4).
 *
 * A server component wrapping the fetch in try/catch, per this deliverable's
 * house pattern (`/compare`'s page, `/claims`'s page). Three outcomes, each
 * with its own state: the claim genuinely does not exist (`not_found` — a
 * stale link or a typo, distinct from a database problem), the database is
 * unreachable (`error`, retryable), or the claim loaded (`ok`, handed to the
 * client-side `ClaimKit`).
 *
 * `EmptyState`'s built-in `action` slot takes an `onClick` closure, which
 * cannot cross the server→client boundary from a plain server component —
 * so the not-found/error states use a real `<Link>` for navigation instead
 * of that slot, which also happens to be more accessible (works without JS,
 * keyboard-reachable without any extra wiring).
 */
export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const result = await loadClaimKit(id, session.userId);

  if (result.kind === 'not_found') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 lg:p-6">
        <EmptyState message="This claim doesn't exist, or the link is stale." />
        <Link href="/claims" className="self-center text-sm text-text-secondary underline-offset-2 hover:underline">
          Back to claims
        </Link>
      </div>
    );
  }

  if (result.kind === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 lg:p-6">
        <EmptyState message={result.message} />
        <Link href="/claims" className="self-center text-sm text-text-secondary underline-offset-2 hover:underline">
          Back to claims
        </Link>
      </div>
    );
  }

  return <ClaimKit data={result.data} />;
}

async function loadClaimKit(id: string, userId: string): Promise<LoadResult> {
  try {
    const [{ db }, schema, drizzleOrm] = await Promise.all([
      import('@/infrastructure/persistence/db'),
      import('@/infrastructure/persistence/schema'),
      import('drizzle-orm'),
    ]);
    const { CHANNEL_DEFINITIONS } = await import('@/domain/rules/channels.rules');
    const { daysBetween } = await import('@/domain/shared/Clock');

    const { claims, bookings, comparisons, properties, competingRates } = schema;
    const { and, eq } = drizzleOrm;

    const rows = await db
      .select({
        claim: claims,
        booking: bookings,
        comparison: comparisons,
        property: properties,
        competingRate: competingRates,
      })
      .from(claims)
      .innerJoin(bookings, eq(claims.bookingId, bookings.id))
      .leftJoin(comparisons, eq(bookings.comparisonId, comparisons.id))
      .leftJoin(properties, eq(comparisons.propertyId, properties.id))
      .leftJoin(competingRates, eq(claims.competingRateId, competingRates.id))
      // Owner-scoped: a claim UUID alone must never be enough to read someone
      // else's claim kit. A wrong-owner id renders the same `not_found` as a
      // missing one — the response never confirms the id exists.
      .where(and(eq(claims.id, id), eq(claims.userId, userId)))
      .limit(1);

    const row = rows[0];
    if (!row) return { kind: 'not_found' };

    const { claim, booking, comparison, property, competingRate } = row;

    // §7.4 item 4 needs a per-night rate; a booking not tied to a saved
    // comparison still has real check-in/check-out dates to derive it from.
    const nights = Math.max(1, daysBetween(new Date(booking.checkIn), new Date(booking.checkOut)));
    const guestCount = comparison ? comparison.adults + comparison.children : 2;

    const data: ClaimKitData = {
      id: claim.id,
      userId: claim.userId,
      bookingId: claim.bookingId,
      kind: claim.kind,
      status: claim.status,
      deadlineAt: claim.deadlineAt.toISOString(),
      claimedGapCents: claim.claimedGapCents,
      awardedCents: claim.awardedCents,
      submittedAt: claim.submittedAt?.toISOString() ?? null,
      resolvedAt: claim.resolvedAt?.toISOString() ?? null,
      denialReason: claim.denialReason,
      notes: claim.notes,
      competingRateId: claim.competingRateId,

      hotelName: comparison?.propertyNameSnapshot ?? property?.name ?? 'Unlinked booking',
      hotelAddress: property?.address ?? 'Not recorded',
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights,
      roomType: comparison?.roomType ?? 'Not recorded',
      bedType: comparison?.bedType ?? 'Not recorded',
      guestCount,
      currency: comparison?.currency ?? 'USD',
      cancellationPolicy: booking.refundable
        ? "Refundable, per the rate's stated cancellation deadline"
        : 'Non-refundable',
      bookingChannelLabel: CHANNEL_DEFINITIONS[booking.channel].label,
      bookedAt: booking.bookedAt.toISOString(),
      ownTotalCents: booking.totalCents,
      ownBaseCents: booking.baseCents,

      competitor: competingRate
        ? {
            baseCents: competingRate.baseCents,
            totalCents: competingRate.taxCents !== null ? competingRate.baseCents + competingRate.taxCents : null,
            siteDomain: competingRate.siteDomain,
            url: competingRate.url,
          }
        : null,
    };

    return { kind: 'ok', data };
  } catch {
    return { kind: 'error', message: "Couldn't load this claim. The database may be unreachable." };
  }
}
