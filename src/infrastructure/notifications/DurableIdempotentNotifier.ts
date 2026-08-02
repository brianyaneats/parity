import type { Logger } from '@/infrastructure/observability/Logger';
import type { NotificationMessage, NotificationResult, Notifier } from '@/application/ports/Notifier';
import type { NotificationsSentRepository } from '@/application/ports/NotificationsSentRepository';

/**
 * The second of three dedup layers around every real notification send —
 * see `createNotifier.ts` for how the three compose. This one is what closes
 * the cold-start gap the other two cannot:
 *
 * - `IdempotentNotifier`'s in-process `Map` is the cheap first check, but it
 *   is empty on every cold start.
 * - `ResendNotifier`'s `Idempotency-Key` header is the third, network-level
 *   check, but it only exists once `RESEND_API_KEY` is configured, and its
 *   own dedupe window is provider-controlled, not this product's to rely on
 *   indefinitely.
 * - Neither survives "the process that sent the last checkpoint is not the
 *   process handling this one," which on Vercel's every-15-minutes
 *   `claim-deadline-sweep` (§9) is the *normal* case, not an edge case. That
 *   gap plus `ClaimDeadlineSweepUseCase`'s deliberately wide "due" window
 *   (every crossed checkpoint is re-evaluated on every tick, so a missed tick
 *   still fires later) meant the same checkpoint could and did re-send on
 *   every single tick for as long as a claim stayed open — Part 9's own
 *   "never more than three notifications per claim" was not actually true in
 *   the deployed environment.
 *
 * This decorator durably claims a message's `idempotencyKey` in
 * `notifications_sent` *before* calling the wrapped notifier —
 * `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *` via
 * `NotificationsSentRepository.tryClaim`. The unique index is what arbitrates
 * a race between two concurrent invocations, not a read here followed by a
 * write; a read-then-write has a window in which both invocations observe
 * "not yet sent" and both proceed, which is exactly the bug this exists to
 * close. Whichever call's `INSERT` actually lands owns the send; the other
 * gets back `null` and is told it was deduped without the wrapped notifier
 * ever being invoked.
 *
 * A message with no `userId` (see `Notifier.ts`) is outside this decorator's
 * remit — there is no attributable row to claim — and is delegated straight
 * through to the wrapped notifier unchanged.
 *
 * **Failure posture.** If the durable check itself throws (the database is
 * unreachable), this fails toward *not sending* rather than falling through
 * to send anyway: a missed reminder still has the sweep's checkpoint
 * redundancy behind it (three checkpoints for a claim, four for a credit
 * bucket, another week for the staleness digest), while a duplicate send —
 * the exact failure mode this class exists to prevent — teaches the user to
 * ignore the product. The same posture applies once a claim succeeds: a
 * claimed row is never rolled back, even if the wrapped notifier's `send`
 * subsequently reports failure, for the identical reason — retrying would
 * reopen the very race this class exists to close, and the sweep's
 * checkpoint redundancy is the intended mitigation for a single lost send,
 * not a compensating delete.
 */
export class DurableIdempotentNotifier implements Notifier {
  constructor(
    private readonly repository: NotificationsSentRepository,
    private readonly inner: Notifier,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async send(message: NotificationMessage): Promise<NotificationResult> {
    if (!message.userId) {
      this.logger.debug('notification has no userId — durable dedup layer skipped', {
        idempotencyKey: message.idempotencyKey,
      });
      return this.inner.send(message);
    }

    let claimed: boolean;
    try {
      const row = await this.repository.tryClaim({
        userId: message.userId,
        idempotencyKey: message.idempotencyKey,
        kind: deriveNotificationKind(message.idempotencyKey),
        sentAt: this.now(),
        channel: 'EMAIL',
      });
      claimed = row !== null;
    } catch (error) {
      this.logger.error(
        'durable notification dedup check failed — treating as unsent rather than risk a duplicate send',
        error,
        { idempotencyKey: message.idempotencyKey, to: message.to },
      );
      return { sent: false, deduped: false };
    }

    if (!claimed) {
      return { sent: false, deduped: true };
    }

    return this.inner.send(message);
  }
}

/**
 * The `notifications_sent.kind` value for a message: the idempotency key's
 * prefix up to (not including) its first `:`. Every §9 job's key is already
 * namespaced this way (`claim-deadline:{id}:{h}h`, `bucket-expiry:{id}:{d}d:
 * {windowEnd}`, `watchlist-reshop:{id}:{date}`, `rule-staleness:{userId}:
 * {week}`), so this reuses that existing structure instead of asking every
 * call site to also pass a redundant `kind` alongside the key.
 */
export function deriveNotificationKind(idempotencyKey: string): string {
  const separatorIndex = idempotencyKey.indexOf(':');
  return separatorIndex === -1 ? idempotencyKey : idempotencyKey.slice(0, separatorIndex);
}
