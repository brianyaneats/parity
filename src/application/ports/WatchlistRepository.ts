export interface WatchlistRecord {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string;
  readonly cadenceDays: number;
  readonly lastCheckedAt: Date | null;
  readonly nextCheckAt: Date;
  readonly active: boolean;
}

export interface NewWatchlistInput {
  readonly userId: string;
  readonly bookingId: string;
  readonly cadenceDays?: number;
  readonly nextCheckAt: Date;
}

/**
 * A due watchlist row plus what `watchlist-reshop` (§9) needs to build the
 * re-shop reminder and to decide the "cancellation deadline still ≥ 2 days out"
 * gate, without a second query per row.
 */
export interface WatchlistSweepRow {
  readonly entry: WatchlistRecord;
  readonly propertyNameSnapshot: string;
  readonly comparisonId: string | null;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly cancelDeadline: string | null;
  readonly userEmail: string;
  readonly userTimezone: string;
}

export interface WatchlistRepository {
  create(input: NewWatchlistInput): Promise<WatchlistRecord>;
  listByUser(userId: string): Promise<readonly WatchlistRecord[]>;
  delete(id: string, userId: string): Promise<boolean>;

  /**
   * Deactivates the (at most one) active watchlist row for a booking — §7.6:
   * "Cancelling or completing a booking must deactivate its watchlist row —
   * a reminder to re-shop a stay you already took is worse than no
   * reminder." Looked up by `bookingId` rather than the watchlist row's own
   * id because the caller (`UpdateBookingUseCase`, reacting to a
   * `booking.cancelled`/`booking.completed` domain event) only ever has the
   * booking's id in hand. A no-op, not an error, when the booking never had
   * a watchlist row (it was never re-shoppable, or was already inactive).
   * Returns whether a row was actually deactivated.
   */
  deactivateForBooking(bookingId: string, userId: string): Promise<boolean>;

  /**
   * Atomically claims every row due at or before `now` — advances
   * `next_check_at` by `cadence_days` and sets `last_checked_at = now` in the
   * same statement (`UPDATE … WHERE next_check_at <= now RETURNING …`) — so a
   * concurrent double-fire of the job can only ever claim a given row once:
   * whichever invocation's `UPDATE` commits first moves `next_check_at` into
   * the future, and the second invocation's `WHERE` clause no longer matches
   * it. This is the job's entire idempotency mechanism (§9) — no separate
   * "already notified" flag is needed because the due-ness check and the
   * state change are the same atomic statement.
   */
  claimDueForSweep(now: Date): Promise<readonly WatchlistSweepRow[]>;

  /**
   * Read-only equivalent of `claimDueForSweep`, for `?dry=1` (§9): reports
   * what is due without advancing `next_check_at` or `last_checked_at`, so a
   * dry run has no side effects at all, not just "no email sent."
   */
  peekDueForSweep(now: Date): Promise<readonly WatchlistSweepRow[]>;
}
