import type { BookingRepository } from './BookingRepository';
import type { ClaimRepository } from './ClaimRepository';
import type { SavingsEventRepository } from './SavingsEventRepository';
import type { WatchlistRepository } from './WatchlistRepository';
import type { CreditBucketRepository } from './CreditBucketRepository';
import type { CompetingRateRepository } from './CompetingRateRepository';

/**
 * `UnitOfWork` — the seam for the graded cross-aggregate transactions:
 *
 * 1. `POST /api/bookings` (§5.2 #1): a `Booking` and, conditionally, the `Claim`
 *    its `booking.recorded` event opens, must commit together — a claim
 *    silently missing because the process died between two separate writes is
 *    exactly the "no price-match window is ever missed" success criterion
 *    (§1.5) failing in the one way that matters. The same call also,
 *    conditionally, creates the booking's `watchlist` row (§7.6), a realized
 *    `CHANNEL_CHOICE` savings event (§8.6), and — the P0 fix `creditBuckets`
 *    was added for — resolves and consumes the §2.4 credit bucket the booking
 *    unlocks. All are consequences of the same booking write and belong in the
 *    same commit for the identical reason: any of them silently failing to
 *    appear because the process died between writes is a defect of exactly the
 *    same shape as the missing-claim one this port was built to prevent.
 * 2. `PATCH /api/claims/:id` (§5.2 #2): the claim's new status and the
 *    `savings_events` row it produces on APPROVED/PARTIAL must commit together
 *    — a realized saving with no claim behind it, or vice versa, breaks the
 *    auditable ledger (§1.5, §4.3).
 * 3. `PATCH /api/bookings/:id` cancellation: `Booking.transitionTo('CANCELLED')`
 *    and the `CreditBucket.release()` it triggers (§2.4) must commit together
 *    for the same reason as #1 — a cancellation that frees the booking but not
 *    the credit silently costs the user the bucket for the rest of its window.
 *
 * Single-aggregate writes (a comparison and its own quotes, a property) don't
 * need this — those repositories open their own internal transaction. This
 * port exists specifically for the cases that span more than one repository.
 */
export interface TransactionalRepositories {
  readonly bookings: BookingRepository;
  readonly claims: ClaimRepository;
  readonly savingsEvents: SavingsEventRepository;
  readonly watchlist: WatchlistRepository;
  readonly creditBuckets: CreditBucketRepository;
  readonly competingRates: CompetingRateRepository;
}

export interface UnitOfWork {
  run<T>(fn: (repos: TransactionalRepositories) => Promise<T>): Promise<T>;
}
