import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { bookings, comparisons, users, userSettings, watchlist, type WatchlistRow } from '../schema';
import type {
  NewWatchlistInput,
  WatchlistRecord,
  WatchlistRepository,
  WatchlistSweepRow,
} from '@/application/ports/WatchlistRepository';
import type { DrizzleHandle } from './drizzle-handle';

/**
 * Drizzle-backed `WatchlistRepository`.
 *
 * Accepts an optional `DrizzleHandle`, the same shape `DrizzleBookingRepository`
 * does: `DrizzleUnitOfWork` hands it an open transaction (`tx`) so a booking's
 * watchlist row commits atomically with the booking itself (§7.6, `UnitOfWork`'s
 * own doc comment), while route-local and cron callers construct it with no
 * arguments and use the ordinary pooled client.
 *
 * `claimDueForSweep` performs the atomic claim (`UPDATE … WHERE
 * next_check_at <= now RETURNING …`, advancing `next_check_at` by
 * `cadence_days` and stamping `last_checked_at = now` in the same statement)
 * and then a second pass of plain selects to enrich each *already-claimed*
 * row with what the reminder email needs. Drizzle has no first-class way to
 * join inside an `UPDATE … RETURNING`, but the enrichment reads only the ids
 * the UPDATE already committed to — they never re-check due-ness, so they
 * cannot affect which rows get claimed or duplicate a claim.
 */
export class DrizzleWatchlistRepository implements WatchlistRepository {
  constructor(private readonly handle: DrizzleHandle = db) {}

  public async create(input: NewWatchlistInput): Promise<WatchlistRecord> {
    const [row] = await this.handle
      .insert(watchlist)
      .values({
        userId: input.userId,
        bookingId: input.bookingId,
        // `undefined` maps to the column's `DEFAULT` (7) rather than NULL.
        cadenceDays: input.cadenceDays,
        nextCheckAt: input.nextCheckAt,
      })
      .returning();

    if (!row) {
      throw new Error('Insert into watchlist did not return a row.');
    }
    return toRecord(row);
  }

  public async listByUser(userId: string): Promise<readonly WatchlistRecord[]> {
    const rows = await this.handle.select().from(watchlist).where(eq(watchlist.userId, userId));
    return rows.map(toRecord);
  }

  public async delete(id: string, userId: string): Promise<boolean> {
    const rows = await this.handle
      .delete(watchlist)
      .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
      .returning({ id: watchlist.id });
    return rows.length > 0;
  }

  public async deactivateForBooking(bookingId: string, userId: string): Promise<boolean> {
    const rows = await this.handle
      .update(watchlist)
      .set({ active: false })
      .where(
        and(
          eq(watchlist.bookingId, bookingId),
          eq(watchlist.userId, userId),
          eq(watchlist.active, true),
        ),
      )
      .returning({ id: watchlist.id });
    return rows.length > 0;
  }

  public async claimDueForSweep(now: Date): Promise<readonly WatchlistSweepRow[]> {
    const claimed = await this.handle
      .update(watchlist)
      .set({
        lastCheckedAt: now,
        nextCheckAt: sql`${watchlist.nextCheckAt} + (${watchlist.cadenceDays} * interval '1 day')`,
      })
      .where(and(eq(watchlist.active, true), lte(watchlist.nextCheckAt, now)))
      .returning();

    return this.enrich(claimed);
  }

  /** Read-only preview for `?dry=1` — same due-ness check, no `UPDATE`. */
  public async peekDueForSweep(now: Date): Promise<readonly WatchlistSweepRow[]> {
    const due = await this.handle
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.active, true), lte(watchlist.nextCheckAt, now)));

    return this.enrich(due);
  }

  private async enrich(claimed: readonly WatchlistRow[]): Promise<readonly WatchlistSweepRow[]> {
    if (claimed.length === 0) return [];

    const bookingIds = [...new Set(claimed.map((row) => row.bookingId))];
    const userIds = [...new Set(claimed.map((row) => row.userId))];

    const [bookingRows, userRows] = await Promise.all([
      this.handle
        .select({
          id: bookings.id,
          comparisonId: bookings.comparisonId,
          channel: bookings.channel,
          checkIn: bookings.checkIn,
          checkOut: bookings.checkOut,
          cancelDeadline: bookings.cancelDeadline,
          propertyNameSnapshot: comparisons.propertyNameSnapshot,
        })
        .from(bookings)
        .leftJoin(comparisons, eq(bookings.comparisonId, comparisons.id))
        .where(inArray(bookings.id, bookingIds)),
      this.handle
        .select({
          id: users.id,
          email: users.email,
          timezone: userSettings.timezone,
        })
        .from(users)
        .leftJoin(userSettings, eq(userSettings.userId, users.id))
        .where(inArray(users.id, userIds)),
    ]);

    const bookingById = new Map(bookingRows.map((row) => [row.id, row]));
    const userById = new Map(userRows.map((row) => [row.id, row]));

    const result: WatchlistSweepRow[] = [];
    for (const row of claimed) {
      const booking = bookingById.get(row.bookingId);
      const user = userById.get(row.userId);
      // Both are guaranteed by the FK constraints on `watchlist`. A defensive
      // skip rather than a throw — one odd row should never sink the sweep.
      if (!booking || !user) continue;

      result.push({
        entry: toRecord(row),
        propertyNameSnapshot: booking.propertyNameSnapshot ?? booking.channel ?? 'your stay',
        comparisonId: booking.comparisonId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        cancelDeadline: booking.cancelDeadline,
        userEmail: user.email,
        userTimezone: user.timezone ?? 'America/New_York',
      });
    }
    return result;
  }
}

function toRecord(row: WatchlistRow): WatchlistRecord {
  return {
    id: row.id,
    userId: row.userId,
    bookingId: row.bookingId,
    cadenceDays: row.cadenceDays,
    lastCheckedAt: row.lastCheckedAt,
    nextCheckAt: row.nextCheckAt,
    active: row.active,
  };
}
