import type { NotificationMessage, NotificationResult, Notifier } from '@/application/ports/Notifier';

/**
 * "Every job must be idempotent and keyed so a double-fire cannot
 * double-send" (§9). This decorator is where that lives, once, for every
 * `Notifier` implementation — see `Notifier.ts`'s module doc for the full
 * reasoning.
 *
 * A `Map<idempotencyKey, expiryEpochMs>` in process memory: a second `send()`
 * with a key already recorded is suppressed without calling the wrapped
 * notifier at all. This is what makes "run a sweep twice, assert one
 * notification" true within a single test/process. Across separate
 * serverless invocations this memory does not persist — `ResendNotifier`'s
 * `Idempotency-Key` header is the second, cross-process layer for that case
 * (see its module doc). Entries expire after `ttlMs` (default 24h, matching
 * the longest realistic gap between two related cron ticks) so the map
 * cannot grow without bound in a long-lived warm instance.
 */
export class IdempotentNotifier implements Notifier {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly inner: Notifier,
    private readonly ttlMs: number = 24 * 60 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async send(message: NotificationMessage): Promise<NotificationResult> {
    this.evictExpired();

    if (this.seen.has(message.idempotencyKey)) {
      return { sent: false, deduped: true };
    }

    const result = await this.inner.send(message);
    if (result.sent) this.seen.set(message.idempotencyKey, this.now() + this.ttlMs);
    return result;
  }

  private evictExpired(): void {
    const cutoff = this.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= cutoff) this.seen.delete(key);
    }
  }
}
