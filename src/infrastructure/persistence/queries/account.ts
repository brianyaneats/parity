import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  users,
  userSettings,
  cards,
  creditBuckets,
  trips,
  properties,
  comparisons,
  quotes,
  competingRates,
  bookings,
  claims,
  watchlist,
  savingsEvents,
  ruleFlags,
  notificationsSent,
  evidenceBlobs,
  creditPostings,
} from '../schema';

/**
 * Account export and deletion — §12, non-negotiable.
 *
 * > "**Data export and deletion** must both work from `/settings` and must
 * > actually cascade. Test it."
 *
 * Two things make this more than a `SELECT *`:
 *
 * 1. **`quotes` and `competing_rates` carry no `user_id`** (§4.2 scopes them
 *    through `comparison_id`). A naive "export every table with a userId
 *    column" therefore silently omits the user's own entered rates — the exact
 *    data they would most want back. Both are reached through their parent
 *    comparisons here.
 * 2. **§12 requires screenshots in both paths.** `competing_rates.screenshot_key`
 *    points at private object storage, so the export lists the keys and the
 *    deletion returns them for the caller to purge from storage — the database
 *    cascade alone would leave the images orphaned and readable.
 *
 *    That storage is now `evidence_blobs` (`PostgresSignedUrlStorage` — see
 *    `schema.ts`'s doc comment on that table), which unlike the two points
 *    above genuinely does cascade with the rest of the user's rows on delete
 *    (it has the same `userId` `ON DELETE CASCADE` FK every other table
 *    here has, so `deleteAccount`'s single `DELETE FROM users` already
 *    reaches it with no extra code). The export below still lists it
 *    explicitly, metadata only — `contentType`/`sizeBytes`/`createdAt`, never
 *    the `bytes` column itself, the same reasoning `screenshotKeys` gives for
 *    carrying a pointer rather than embedding image data in a JSON export.
 */

export interface AccountExport {
  readonly exportedAt: string;
  readonly user: Record<string, unknown> | null;
  readonly settings: Record<string, unknown> | null;
  readonly cards: readonly Record<string, unknown>[];
  readonly creditBuckets: readonly Record<string, unknown>[];
  readonly trips: readonly Record<string, unknown>[];
  readonly properties: readonly Record<string, unknown>[];
  readonly comparisons: readonly Record<string, unknown>[];
  readonly quotes: readonly Record<string, unknown>[];
  readonly competingRates: readonly Record<string, unknown>[];
  readonly bookings: readonly Record<string, unknown>[];
  readonly claims: readonly Record<string, unknown>[];
  readonly watchlist: readonly Record<string, unknown>[];
  readonly savingsEvents: readonly Record<string, unknown>[];
  readonly ruleFlags: readonly Record<string, unknown>[];
  /** What the product emailed this user — their data too, per §12. */
  readonly notificationsSent: readonly Record<string, unknown>[];
  /** `evidence_blobs` metadata only — see this file's module doc for why `bytes` is excluded. */
  readonly evidenceBlobs: readonly Record<string, unknown>[];
  readonly creditPostings: readonly Record<string, unknown>[];
  /** Object-storage keys the user should also be given, per §12. */
  readonly screenshotKeys: readonly string[];
}

export async function exportAccount(userId: string, now: Date): Promise<AccountExport> {
  const [
    userRows,
    settingsRows,
    cardRows,
    bucketRows,
    tripRows,
    propertyRows,
    comparisonRows,
    bookingRows,
    claimRows,
    watchlistRows,
    savingsRows,
    flagRows,
    notificationRows,
    evidenceBlobRows,
    creditPostingRows,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)),
    db.select().from(cards).where(eq(cards.userId, userId)),
    db.select().from(creditBuckets).where(eq(creditBuckets.userId, userId)),
    db.select().from(trips).where(eq(trips.userId, userId)),
    // Only the user's own property overrides. Seeded rows have `user_id = NULL`
    // and are not theirs to export.
    db.select().from(properties).where(eq(properties.userId, userId)),
    db.select().from(comparisons).where(eq(comparisons.userId, userId)),
    db.select().from(bookings).where(eq(bookings.userId, userId)),
    db.select().from(claims).where(eq(claims.userId, userId)),
    db.select().from(watchlist).where(eq(watchlist.userId, userId)),
    db.select().from(savingsEvents).where(eq(savingsEvents.userId, userId)),
    db.select().from(ruleFlags).where(eq(ruleFlags.userId, userId)),
    db.select().from(notificationsSent).where(eq(notificationsSent.userId, userId)),
    // Metadata only — never `bytes` — see this file's module doc.
    db
      .select({
        id: evidenceBlobs.id,
        contentType: evidenceBlobs.contentType,
        sizeBytes: evidenceBlobs.sizeBytes,
        createdAt: evidenceBlobs.createdAt,
      })
      .from(evidenceBlobs)
      .where(eq(evidenceBlobs.userId, userId)),
    db.select().from(creditPostings).where(eq(creditPostings.userId, userId)),
  ]);

  // The two child tables scoped only through their parent comparison.
  const comparisonIds = comparisonRows.map((row) => row.id);
  const [quoteRows, competingRateRows] =
    comparisonIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.select().from(quotes).where(inArray(quotes.comparisonId, comparisonIds)),
          db
            .select()
            .from(competingRates)
            .where(inArray(competingRates.comparisonId, comparisonIds)),
        ]);

  return {
    exportedAt: now.toISOString(),
    user: userRows[0] ?? null,
    settings: settingsRows[0] ?? null,
    cards: cardRows,
    creditBuckets: bucketRows,
    trips: tripRows,
    properties: propertyRows,
    comparisons: comparisonRows,
    quotes: quoteRows,
    competingRates: competingRateRows,
    bookings: bookingRows,
    claims: claimRows,
    watchlist: watchlistRows,
    savingsEvents: savingsRows,
    ruleFlags: flagRows,
    notificationsSent: notificationRows,
    evidenceBlobs: evidenceBlobRows,
    creditPostings: creditPostingRows,
    screenshotKeys: competingRateRows
      .map((row) => row.screenshotKey)
      .filter((key): key is string => typeof key === 'string' && key.length > 0),
  };
}

export interface DeletionReceipt {
  readonly deletedAt: string;
  readonly userId: string;
  /** Rows counted *before* the delete, so the receipt says what actually went. */
  readonly rowsRemoved: Readonly<Record<string, number>>;
  /** Storage objects the caller must now purge — §12. */
  readonly screenshotKeys: readonly string[];
}

/**
 * Deletes the account and everything hanging off it.
 *
 * The single `DELETE FROM users` relies on `ON DELETE CASCADE`, which §4.1
 * specifies on every user-scoped table. That is deliberate: enumerating child
 * deletes by hand would mean a table added later is silently missed, whereas a
 * missing cascade is caught by the test that asserts every table is empty
 * afterwards.
 *
 * Screenshot keys are gathered *before* the delete, because after it the rows
 * that name them are gone and the images would be unreachable but not removed.
 */
export async function deleteAccount(userId: string, now: Date): Promise<DeletionReceipt> {
  const snapshot = await exportAccount(userId, now);

  const rowsRemoved: Record<string, number> = {
    cards: snapshot.cards.length,
    creditBuckets: snapshot.creditBuckets.length,
    trips: snapshot.trips.length,
    properties: snapshot.properties.length,
    comparisons: snapshot.comparisons.length,
    quotes: snapshot.quotes.length,
    competingRates: snapshot.competingRates.length,
    bookings: snapshot.bookings.length,
    claims: snapshot.claims.length,
    watchlist: snapshot.watchlist.length,
    savingsEvents: snapshot.savingsEvents.length,
    ruleFlags: snapshot.ruleFlags.length,
    notificationsSent: snapshot.notificationsSent.length,
    evidenceBlobs: snapshot.evidenceBlobs.length,
    creditPostings: snapshot.creditPostings.length,
  };

  await db.delete(users).where(eq(users.id, userId));

  return {
    deletedAt: now.toISOString(),
    userId,
    rowsRemoved: Object.freeze(rowsRemoved),
    screenshotKeys: snapshot.screenshotKeys,
  };
}
