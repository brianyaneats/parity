import type { Logger } from '@/infrastructure/observability/Logger';
import type { NotificationMessage, NotificationResult, Notifier } from '@/application/ports/Notifier';

/**
 * Resend implementation of `Notifier` — §9.
 *
 * `text` is always sent (the port requires it — every message has a
 * plain-text alternative). The `Idempotency-Key` header is Resend's own
 * duplicate-suppression mechanism: passing the same key on a retried or
 * genuinely double-fired request is a second layer of "double-fire cannot
 * double-send" underneath the in-process `IdempotentNotifier` decorator this
 * class is always wrapped in (see `createNotifier.ts`) — the decorator
 * catches a duplicate within one warm process; this header catches one across
 * two separate serverless invocations that both reach the network.
 */
export class ResendNotifier implements Notifier {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly logger: Logger,
  ) {}

  public async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error('Resend send failed', undefined, { status: response.status, body });
        return { sent: false, deduped: false };
      }

      return { sent: true, deduped: false };
    } catch (error) {
      this.logger.error('Resend send threw', error, { to: message.to });
      return { sent: false, deduped: false };
    }
  }
}
