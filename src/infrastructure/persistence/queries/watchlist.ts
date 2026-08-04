import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { bookings, comparisons, watchlist } from '../schema';
import { CHANNEL_DEFINITIONS } from '@/domain/rules/channels.rules';
import type { WatchlistBookingRow } from '@/features/watchlist/types';

/**
 * The `/watchlist` screen's real read — §7.6.
 *
 * Follows `properties.ts`'s and `ledger.ts`'s own pattern in this directory: a
 * plain join, no ORM relation traversal, RSC-serialisable rows out. Joined
 * through `bookings` so every row carries what `WatchlistScreen` needs to
 * rehydrate a `Booking` and call `isReshoppable` client-side (its own doc
 * comment explains why the screen re-checks that rather than trusting
 * `watchlist.active` alone: `active` only tracks cancellation/completion,
 * `isReshoppable` also catches a cancellation deadline that has since passed).
 *
 * Scoped to `active = true` at the query level — an inactive row (its booking
 * was cancelled or completed, per `RecordBookingUseCase`/`UpdateBookingUseCase`)
 * has nothing to show on this screen at all, unlike a still-active row whose
 * deadline has merely passed, which `WatchlistScreen` itself still wants to
 * filter out (with different messaging) rather than never receiving.
 *
 * `bookings.prepaid` does not exist as a column (the same documented schema
 * gap `booking-mapper.ts`'s `toBookingProps` works around) — this falls back
 * to `CHANNEL_DEFINITIONS[channel].typicallyPrepaid` for exactly the same
 * reason: `WatchlistScreen`'s `isReshoppable` check does not read `prepaid`
 * at all, so the fallback is inert here too.
 *
 * `userId` is required — the optional-with-unfiltered-fallback version of this
 * signature is how `/watchlist` once served every user's bookings to anyone.
 */
export async function listWatchlistBookings(userId: string): Promise<WatchlistBookingRow[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      userId: bookings.userId,
      comparisonId: bookings.comparisonId,
      propertyNameSnapshot: comparisons.propertyNameSnapshot,
      channel: bookings.channel,
      confirmationNumber: bookings.confirmationNumber,
      bookedAt: bookings.bookedAt,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      totalCents: bookings.totalCents,
      baseCents: bookings.baseCents,
      cashChargedCents: bookings.cashChargedCents,
      pointsUsed: bookings.pointsUsed,
      refundable: bookings.refundable,
      cancelDeadline: bookings.cancelDeadline,
      bucketId: bookings.bucketId,
      status: bookings.status,
      watchlistId: watchlist.id,
      cadenceDays: watchlist.cadenceDays,
      lastCheckedAt: watchlist.lastCheckedAt,
      nextCheckAt: watchlist.nextCheckAt,
      active: watchlist.active,
    })
    .from(watchlist)
    .innerJoin(bookings, eq(watchlist.bookingId, bookings.id))
    .leftJoin(comparisons, eq(bookings.comparisonId, comparisons.id))
    .where(and(eq(watchlist.active, true), eq(watchlist.userId, userId)))
    .orderBy(asc(watchlist.nextCheckAt));

  return rows.map((row) => ({
    id: row.bookingId,
    userId: row.userId,
    comparisonId: row.comparisonId,
    propertyName: row.propertyNameSnapshot ?? CHANNEL_DEFINITIONS[row.channel].label,
    channel: row.channel,
    confirmationNumber: row.confirmationNumber,
    bookedAt: row.bookedAt.toISOString(),
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    totalCents: row.totalCents,
    baseCents: row.baseCents,
    cashChargedCents: row.cashChargedCents,
    pointsUsed: row.pointsUsed,
    prepaid: CHANNEL_DEFINITIONS[row.channel].typicallyPrepaid,
    refundable: row.refundable,
    cancelDeadline: row.cancelDeadline,
    bucketId: row.bucketId,
    status: row.status,
    watchlistId: row.watchlistId,
    cadenceDays: row.cadenceDays,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    nextCheckAt: row.nextCheckAt.toISOString(),
    active: row.active,
    cheaperOptionCents: null,
  }));
}
