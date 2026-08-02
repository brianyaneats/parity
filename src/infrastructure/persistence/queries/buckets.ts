import { DrizzleCreditBucketRepository } from '../repositories/DrizzleCreditBucketRepository';
import { toCreditBucketAggregate } from '@/application/mappers/credit-bucket-mapper';
import type { CreditBucket } from '@/domain/credit/CreditBucket';

/**
 * Live credit-bucket read for `/compare`'s server-side hydration — §5.3, the
 * comparator's Defect A (optimistic/authoritative input drift).
 *
 * §5.3 promises the client computes optimistically from *the same engine* as
 * the server, and that the server response is authoritative. The math was
 * already shared, but the *inputs* were not: `CompareScreen` used to guess
 * `amexBucketAvailable`/`editBucketAvailable` as `false` before any server
 * response existed, so the very first optimistic pass — and everything the
 * user saw for the ~300ms of the debounce — was computed against a fabricated
 * "no credit left" assumption, then visibly overridden once
 * `POST /api/compare` (via `CompareChannelsUseCase`) substituted the caller's
 * real, live bucket state.
 *
 * This module gives the server *page* (`src/app/(app)/compare/page.tsx`)
 * exactly what `CompareChannelsUseCase` reads for the same purpose, so it can
 * hydrate `CompareScreen`'s initial state with the same real values before
 * the first paint — optimistic and authoritative then agree from keystroke
 * one instead of merely converging after a round trip.
 *
 * Deliberately thin: it delegates the actual table read to
 * `DrizzleCreditBucketRepository` (already the one, tested implementation of
 * "read this user's `credit_buckets` rows") and the aggregate rehydration to
 * `toCreditBucketAggregate` (already the one place that decision is made),
 * rather than hand-rolling a second drizzle query against `credit_buckets` —
 * unlike `properties.ts`'s combobox read, there is no bespoke shaping to do
 * here; the caller (`ComparePage`) only wants `CreditBucket[]` so it can pass
 * it straight to `deriveBucketAvailability`.
 */
export async function listLiveCreditBuckets(userId: string): Promise<CreditBucket[]> {
  const repository = new DrizzleCreditBucketRepository();
  const records = await repository.listByUser(userId);
  return records.map(toCreditBucketAggregate);
}
