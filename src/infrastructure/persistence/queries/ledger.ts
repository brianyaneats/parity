import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { bookings, comparisons, savingsEvents } from '../schema';
import type { SavingsEventKind } from '@/features/ledger/ledger-aggregate';
import type { LedgerEventView } from '@/features/ledger/ledger-types';

/**
 * The savings ledger's event feed — §7.7, §5.2's `GET /api/ledger`.
 *
 * Left-joined through `bookings` to `comparisons` so every row already
 * carries its drill-down target: "Every event is drillable to its booking
 * and its comparison snapshot" (§7.7). An event with no `bookingId` (a
 * manually logged credit burn, say) simply carries nulls through the joins
 * rather than being excluded — `LedgerEventView` and the UI both treat that
 * as "not drillable," not as an error.
 */
export async function listSavingsEvents(userId?: string): Promise<LedgerEventView[]> {
  const rows = await db
    .select({
      id: savingsEvents.id,
      kind: savingsEvents.kind,
      amountCents: savingsEvents.amountCents,
      realized: savingsEvents.realized,
      occurredOn: savingsEvents.occurredOn,
      note: savingsEvents.note,
      bookingId: savingsEvents.bookingId,
      claimId: savingsEvents.claimId,
      comparisonId: comparisons.id,
      propertyLabel: comparisons.propertyNameSnapshot,
      channel: bookings.channel,
    })
    .from(savingsEvents)
    .leftJoin(bookings, eq(savingsEvents.bookingId, bookings.id))
    .leftJoin(comparisons, eq(bookings.comparisonId, comparisons.id))
    .where(userId ? eq(savingsEvents.userId, userId) : sql`true`)
    .orderBy(desc(savingsEvents.occurredOn));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as SavingsEventKind,
    amountCents: row.amountCents,
    realized: row.realized,
    occurredOn: row.occurredOn,
    note: row.note,
    bookingId: row.bookingId,
    claimId: row.claimId,
    comparisonId: row.comparisonId,
    propertyLabel: row.propertyLabel,
    channel: row.channel,
  }));
}
