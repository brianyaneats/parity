import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { bookings, comparisons, savingsEvents, trips } from '../schema';
import type { TripDetailView, TripListItemView } from '@/features/trips/trips-types';

/**
 * Trip queries — §7.8, §4.2.
 *
 * Neither `bookings` nor `savings_events` carries a `tripId` column directly
 * (§4.2's own DDL): a booking links to its originating `comparison_id`, and
 * a comparison links to `trip_id`. So "this trip's savings" is computed by
 * walking trip → comparisons → bookings → savings_events, batched as three
 * `IN (...)` queries rather than one combined join, which keeps each step
 * legible and keeps the query count constant regardless of how many trips or
 * comparisons exist (no N+1 per trip).
 */

export async function listTrips(userId?: string): Promise<TripListItemView[]> {
  const tripRows = await db
    .select()
    .from(trips)
    .where(userId ? eq(trips.userId, userId) : sql`true`)
    .orderBy(desc(trips.createdAt));

  if (tripRows.length === 0) return [];

  const comparisonRows = await db
    .select({ id: comparisons.id, tripId: comparisons.tripId })
    .from(comparisons)
    .where(
      inArray(
        comparisons.tripId,
        tripRows.map((t) => t.id),
      ),
    );

  const comparisonIdsByTrip = new Map<string, string[]>();
  for (const row of comparisonRows) {
    if (!row.tripId) continue;
    const list = comparisonIdsByTrip.get(row.tripId) ?? [];
    list.push(row.id);
    comparisonIdsByTrip.set(row.tripId, list);
  }

  const allComparisonIds = comparisonRows.map((row) => row.id);
  const bookingRows = allComparisonIds.length
    ? await db
        .select({ id: bookings.id, comparisonId: bookings.comparisonId })
        .from(bookings)
        .where(inArray(bookings.comparisonId, allComparisonIds))
    : [];

  const bookingIdsByComparison = new Map<string, string[]>();
  for (const row of bookingRows) {
    if (!row.comparisonId) continue;
    const list = bookingIdsByComparison.get(row.comparisonId) ?? [];
    list.push(row.id);
    bookingIdsByComparison.set(row.comparisonId, list);
  }

  const allBookingIds = bookingRows.map((row) => row.id);
  const eventRows = allBookingIds.length
    ? await db
        .select({
          bookingId: savingsEvents.bookingId,
          amountCents: savingsEvents.amountCents,
          realized: savingsEvents.realized,
        })
        .from(savingsEvents)
        .where(inArray(savingsEvents.bookingId, allBookingIds))
    : [];

  const realizedByBooking = new Map<string, number>();
  for (const row of eventRows) {
    if (!row.bookingId || !row.realized) continue;
    realizedByBooking.set(row.bookingId, (realizedByBooking.get(row.bookingId) ?? 0) + row.amountCents);
  }

  return tripRows.map((trip): TripListItemView => {
    const comparisonIds = comparisonIdsByTrip.get(trip.id) ?? [];
    const bookingIds = comparisonIds.flatMap((id) => bookingIdsByComparison.get(id) ?? []);
    const realizedSavingsCents = bookingIds.reduce(
      (sum, bookingId) => sum + (realizedByBooking.get(bookingId) ?? 0),
      0,
    );

    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      archived: trip.archived,
      comparisonCount: comparisonIds.length,
      bookingCount: bookingIds.length,
      realizedSavingsCents,
    };
  });
}

export async function getTripDetail(tripId: string, userId?: string): Promise<TripDetailView | null> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(userId ? and(eq(trips.id, tripId), eq(trips.userId, userId)) : eq(trips.id, tripId))
    .limit(1);

  if (!trip) return null;

  const comparisonRows = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.tripId, tripId))
    .orderBy(desc(comparisons.checkIn));

  const comparisonIds = comparisonRows.map((row) => row.id);
  const bookingRows = comparisonIds.length
    ? await db
        .select()
        .from(bookings)
        .where(inArray(bookings.comparisonId, comparisonIds))
        .orderBy(desc(bookings.bookedAt))
    : [];

  const bookingIds = bookingRows.map((row) => row.id);
  const eventRows = bookingIds.length
    ? await db
        .select({
          bookingId: savingsEvents.bookingId,
          amountCents: savingsEvents.amountCents,
          realized: savingsEvents.realized,
        })
        .from(savingsEvents)
        .where(inArray(savingsEvents.bookingId, bookingIds))
    : [];

  let realizedSavingsCents = 0;
  let projectedSavingsCents = 0;
  for (const row of eventRows) {
    if (row.realized) realizedSavingsCents += row.amountCents;
    else projectedSavingsCents += row.amountCents;
  }

  return {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    archived: trip.archived,
    realizedSavingsCents,
    projectedSavingsCents,
    comparisons: comparisonRows.map((row) => ({
      id: row.id,
      propertyLabel: row.propertyNameSnapshot,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      nights: row.nights,
      status: row.status,
      chosenChannel: row.chosenChannel ?? null,
    })),
    bookings: bookingRows.map((row) => ({
      id: row.id,
      channel: row.channel,
      bookedAt: row.bookedAt.toISOString(),
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      totalCents: row.totalCents,
      status: row.status,
      cancelDeadline: row.cancelDeadline,
      refundable: row.refundable,
    })),
  };
}
