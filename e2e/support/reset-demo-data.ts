import { db } from '@/infrastructure/persistence/db';
import { users } from '@/infrastructure/persistence/schema';
import { eq } from 'drizzle-orm';
import { DEMO_USER_ID } from './constants';

/**
 * Deletes the demo account so the seed can rebuild it from scratch.
 *
 * One `DELETE FROM users` is enough: §4.1 puts `ON DELETE CASCADE` on every
 * user-scoped foreign key, so settings, cards, buckets, trips, comparisons,
 * quotes, competing rates, bookings, claims, watchlist rows, savings events and
 * property overrides all go with it. Enumerating them here would silently miss
 * whichever table gets added next.
 *
 * Seeded *global* properties (`user_id NULL`) are untouched and simply
 * re-upserted by the seed.
 */
async function reset(): Promise<void> {
  const deleted = await db.delete(users).where(eq(users.id, DEMO_USER_ID)).returning({
    id: users.id,
  });

  console.log(
    deleted.length > 0
      ? `[e2e reset] removed the demo account and everything it owned.`
      : `[e2e reset] no demo account present; nothing to remove.`,
  );
}

reset()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[e2e reset] failed', error);
    process.exit(1);
  });
