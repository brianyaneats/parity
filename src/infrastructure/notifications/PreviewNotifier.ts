import type { Logger } from '@/infrastructure/observability/Logger';
import type { NotificationMessage, NotificationResult, Notifier } from '@/application/ports/Notifier';

/**
 * Backs every cron route's `?dry=1` mode — §9: "Test cron handlers with a
 * `?dry=1` mode that logs what would send without sending."
 *
 * Deliberately **not** wrapped in `IdempotentNotifier` and never records a
 * key anywhere: a dry run must have zero side effects, including on
 * idempotency state, so that running for real immediately afterward still
 * sends. It never touches the network and never touches `IdempotentNotifier`'s
 * dedupe map.
 */
export class PreviewNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  public send(message: NotificationMessage): Promise<NotificationResult> {
    this.logger.info('dry run — would send notification', {
      to: message.to,
      subject: message.subject,
      idempotencyKey: message.idempotencyKey,
    });
    return Promise.resolve({ sent: false, deduped: false });
  }
}
