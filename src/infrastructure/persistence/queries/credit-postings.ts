import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { creditPostings, creditBuckets, bookings, comparisons } from '../schema';
import type { PostingListItem } from '@/features/credits/types';

/**
 * `/credits`' "did it actually post?" read.
 *
 * `userId` is required, never optional — the same discipline `credits.ts`
 * documents for `listCreditBuckets` and `trips.ts` documents (as the pattern
 * it used to follow and no longer does) for `listTrips`: `credit_postings`
 * has a `NOT NULL user_id` FK (§4.2-equivalent DDL in `schema.ts`), so there
 * is no honest meaning for an unfiltered read here, and no code path in this
 * file can run without a `userId` to filter on.
 *
 * Two `leftJoin`s resolve the display strings the attention section needs
 * without a second round trip per row: `creditBuckets` for the bucket label,
 * and `bookings` → `comparisons` for the property name a booking's own
 * `propertyNameSnapshot` lives on (`bookings` itself carries no property name
 * — see `trips.ts`'s own doc comment for why that snapshot lives one hop
 * away). Both are genuinely optional — a posting can be logged by hand with
 * no bucket or booking at all — so `PostingListItem.bucketLabel`/
 * `propertyName` are nullable rather than defaulted to a placeholder string.
 *
 * Ordered oldest-charge-first, matching the index this table was actually
 * built for (`credit_postings_user_status_charged_idx`) and putting the
 * postings most likely to be overdue first before the UI's own urgency sort
 * runs.
 */
export async function listCreditPostings(userId: string): Promise<PostingListItem[]> {
  const rows = await db
    .select({
      id: creditPostings.id,
      bucketId: creditPostings.bucketId,
      bookingId: creditPostings.bookingId,
      expectedCents: creditPostings.expectedCents,
      postedCents: creditPostings.postedCents,
      chargedOn: creditPostings.chargedOn,
      postedOn: creditPostings.postedOn,
      status: creditPostings.status,
      merchantDescriptor: creditPostings.merchantDescriptor,
      note: creditPostings.note,
      bucketLabel: creditBuckets.label,
      propertyName: comparisons.propertyNameSnapshot,
    })
    .from(creditPostings)
    .leftJoin(creditBuckets, eq(creditPostings.bucketId, creditBuckets.id))
    .leftJoin(bookings, eq(creditPostings.bookingId, bookings.id))
    .leftJoin(comparisons, eq(bookings.comparisonId, comparisons.id))
    .where(eq(creditPostings.userId, userId))
    .orderBy(creditPostings.chargedOn, desc(creditPostings.createdAt));

  return rows.map(
    (row): PostingListItem => ({
      id: row.id,
      bucketId: row.bucketId,
      bookingId: row.bookingId,
      expectedCents: row.expectedCents,
      postedCents: row.postedCents,
      chargedOn: row.chargedOn,
      postedOn: row.postedOn,
      status: row.status,
      merchantDescriptor: row.merchantDescriptor,
      note: row.note,
      bucketLabel: row.bucketLabel ?? null,
      propertyName: row.propertyName ?? null,
    }),
  );
}
