/**
 * `Notifier` — port for Part 9's job notifications.
 *
 * "Email via a `Notifier` port … with a Resend implementation plus plain-text
 * alternatives; when `RESEND_API_KEY` is unset, log instead of sending so the
 * jobs are runnable locally." `text` is therefore required, not optional —
 * there is no implementation of this port that is allowed to send HTML-only.
 *
 * **Idempotency lives here, not in each job.** "Every job must be idempotent
 * and keyed so a double-fire cannot double-send." Every message carries a
 * caller-supplied `idempotencyKey`; every implementation (and the
 * `IdempotentNotifier` decorator every implementation is wrapped in — see
 * `src/infrastructure/notifications/IdempotentNotifier.ts`) must treat two
 * `send()` calls with the same key as one delivery. Centralising it here means
 * the four jobs in Part 9 don't each reinvent it, and a fifth job gets it for
 * free.
 */
export interface NotificationMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain-text alternative. Always sent, even when `html` is also present. */
  readonly text: string;
  readonly html?: string;
  /** Stable per logical event, e.g. `claim-deadline:{claimId}:1h`. */
  readonly idempotencyKey: string;
  /**
   * The recipient's user id. Additive (optional) so this stays a
   * backward-compatible change to an existing port: every §9 cron job
   * supplies it — each message it builds already corresponds to exactly one
   * user's row — but a caller outside that job set (`RequestMagicLinkUseCase`
   * is the one example today) is not required to.
   *
   * Consumed by `DurableIdempotentNotifier`
   * (`src/infrastructure/notifications/DurableIdempotentNotifier.ts`) to
   * attribute a row in the `notifications_sent` durable dedup ledger. A
   * message with no `userId` is outside that decorator's remit and is
   * delegated straight through, relying on the in-memory map and Resend's
   * `Idempotency-Key` header alone — unchanged from before that ledger
   * existed.
   */
  readonly userId?: string;
}

export interface NotificationResult {
  /** False when this call was suppressed as a duplicate of an already-sent message. */
  readonly sent: boolean;
  readonly deduped: boolean;
}

export interface Notifier {
  send(message: NotificationMessage): Promise<NotificationResult>;
}
