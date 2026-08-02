/**
 * `NotificationsSentRepository` — durable dedup ledger for Part 9's cron
 * notifications, backed by `notifications_sent` (appended to `schema.ts`;
 * §4.2 does not define this table — see that appended section's own comment,
 * and `DurableIdempotentNotifier`'s module doc, for why it exists).
 *
 * The in-process `IdempotentNotifier` `Map` (§9: "idempotent, keyed so a
 * double-fire cannot double-send") only protects a single warm serverless
 * instance. `claim-deadline-sweep` runs every 15 minutes and Vercel functions
 * cold-start routinely at that cadence, so the map is frequently empty at the
 * start of a tick — with nothing durable behind it, the sweep's own wide "due"
 * window (deliberately re-evaluating every crossed checkpoint on every run, so
 * a missed tick still fires later — see `ClaimDeadlineSweepUseCase`'s module
 * doc) turned "re-send a checkpoint once, later, if delayed" into "re-send it
 * on every single tick for as long as the claim stays open." This repository
 * is what makes one checkpoint's idempotency key durable across a cold start,
 * so the in-memory map becomes a pure optimisation rather than the only line
 * of defence.
 */

/** `channel` on `notifications_sent` — only email exists today (§9). */
export type NotificationChannel = 'EMAIL';

/**
 * The four §9 jobs' idempotency-key prefixes today (see each use case's own
 * `idempotencyKey` template literal). Widened to `| string` — the same
 * reasoning as `CreditBucketRecord.key` in `CreditBucketRepository.ts` — so a
 * future job's kind is stored rather than rejected by the type.
 */
export type NotificationKind = 'claim-deadline' | 'bucket-expiry' | 'watchlist-reshop' | 'rule-staleness';

export interface NotificationSentRecord {
  readonly id: string;
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly kind: NotificationKind | string;
  readonly sentAt: Date;
  readonly channel: NotificationChannel;
}

export interface RecordSentInput {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly kind: NotificationKind | string;
  readonly sentAt: Date;
  readonly channel: NotificationChannel;
}

export interface NotificationsSentRepository {
  /**
   * Durably claims `idempotencyKey` for a first-and-only send —
   * `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *` in the
   * Drizzle implementation. Returns the inserted record when this call won
   * the race; returns `null` when a row for the key already existed.
   *
   * Deliberately insert-first rather than read-then-write: two concurrent
   * callers racing on the same key both reach this method, but the unique
   * index on `idempotency_key` — not a prior `SELECT` — is what arbitrates,
   * so it is not possible for both to observe "not claimed yet" and both
   * proceed to send (see `DurableIdempotentNotifier`).
   */
  tryClaim(input: RecordSentInput): Promise<NotificationSentRecord | null>;
}
