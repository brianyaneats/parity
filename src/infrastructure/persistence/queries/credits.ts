import { DrizzleCreditBucketRepository } from '../repositories/DrizzleCreditBucketRepository';
import type { BucketRow } from '@/features/credits/types';

/**
 * Live `/credits` read — §7.5.
 *
 * `userId` is required, never optional. `properties.ts`'s combobox read can
 * afford an optional `userId` because an omitted one still means something
 * honest there — "seeded, global rows only". There is no seeded/global case
 * for `credit_buckets`: every row belongs to exactly one user (§4.2's
 * `NOT NULL user_id` FK), so an omitted `userId` here has no honest meaning
 * at all. `trips.ts`'s `listTrips(userId?: string)` papers over that same gap
 * with `sql\`true\`` when `userId` is missing — every user's rows, unfiltered
 * — which is the scoping bug this signature is written to make impossible to
 * repeat: there is no code path in this file that can run without a `userId`
 * to filter on.
 *
 * Delegates the table read to `DrizzleCreditBucketRepository` (already the
 * one, tested implementation of "read this user's `credit_buckets` rows",
 * and already used the same way by `queries/buckets.ts` for `/compare`'s
 * hydration) rather than hand-rolling a second query against the same table.
 * Its records are reshaped into `BucketRow` — the flat, RSC-serialisable
 * shape `CreditWallet` reconstructs its `CreditBucket` aggregates from (see
 * `features/credits/types.ts`'s doc comment for why the aggregate itself
 * can't cross the server/client boundary).
 *
 * `windowAssumed` is always `false` here: unlike `computeFallbackBuckets`
 * (which has no cardmember anniversary to work from and says so), every row
 * this function returns was written by the seed or a real booking from the
 * user's own actual dates.
 *
 * Sorted by `windowStart` ascending so `CreditWallet`'s `byCard` grouping —
 * which keeps only the *first* row per bucket key — picks the current window
 * over a future one whenever both exist for the same key (§4.4 seeds a
 * `CARDMEMBER_YEAR` bucket's current *and* next window at once, via
 * `run-seed.ts`'s `windowsToSeed`).
 */
export async function listCreditBuckets(userId: string): Promise<BucketRow[]> {
  const repository = new DrizzleCreditBucketRepository();
  const records = await repository.listByUser(userId);

  return records
    .map(
      (record): BucketRow => ({
        id: record.id,
        userId: record.userId,
        cardId: record.cardId,
        key: record.key,
        label: record.label,
        faceCents: record.faceCents,
        windowStart: record.window.start,
        windowEnd: record.window.end,
        consumedCents: record.consumedCents,
        windowAssumed: false,
      }),
    )
    .sort((a, b) => a.windowStart.localeCompare(b.windowStart));
}
