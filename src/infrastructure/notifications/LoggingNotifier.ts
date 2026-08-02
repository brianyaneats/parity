import type { Logger } from '@/infrastructure/observability/Logger';
import type { NotificationMessage, NotificationResult, Notifier } from '@/application/ports/Notifier';

/**
 * Logs instead of sending — §9: "when `RESEND_API_KEY` is unset, log instead
 * of sending so the jobs are runnable locally." Also what every unit/cron test
 * in this build uses, so a test run never makes a network call.
 */
export class LoggingNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  public send(message: NotificationMessage): Promise<NotificationResult> {
    this.logger.info('notification logged (no RESEND_API_KEY configured)', {
      to: message.to,
      subject: message.subject,
      idempotencyKey: message.idempotencyKey,
    });
    return Promise.resolve({ sent: true, deduped: false });
  }
}
