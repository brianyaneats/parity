import { createLogger, type Logger } from '@/infrastructure/observability/Logger';
import type { Notifier } from '@/application/ports/Notifier';
import { DrizzleNotificationsSentRepository } from '@/infrastructure/persistence/repositories/DrizzleNotificationsSentRepository';
import { LoggingNotifier } from './LoggingNotifier';
import { ResendNotifier } from './ResendNotifier';
import { IdempotentNotifier } from './IdempotentNotifier';
import { DurableIdempotentNotifier } from './DurableIdempotentNotifier';
import { PreviewNotifier } from './PreviewNotifier';

/**
 * Composition helper for the one `Notifier` every cron job depends on.
 *
 * A real send passes through three dedup layers, outermost first:
 *
 * 1. `IdempotentNotifier` — an in-process `Map`, the cheap first check. Free
 *    when it hits, but empty on every cold start.
 * 2. `DurableIdempotentNotifier` — the `notifications_sent` table. This is
 *    the layer that actually survives a cold start; see its module doc for
 *    the defect it closes (the same checkpoint re-sending on every
 *    15-minute tick once the in-memory map alone stood between the sweep
 *    and Resend).
 * 3. `ResendNotifier`'s own `Idempotency-Key` header — a last, provider-side
 *    backstop for whatever reaches the network.
 *
 * `RESEND_API_KEY` unset ⇒ the innermost notifier is `LoggingNotifier`, so
 * every job is still runnable on a clean clone with no email provider
 * configured (§9, §0.4) — the two dedup layers still run in front of it.
 * `dryRun: true` ⇒ `PreviewNotifier`, bypassing all three dedup layers *and*
 * the real send, so a dry run truly has no side effects, including never
 * writing a `notifications_sent` row — the next real run is unaffected by
 * a preceding dry run.
 *
 * The real (non-dry-run) notifier is a **module-level singleton**, not
 * rebuilt per call. That is what lets `IdempotentNotifier`'s in-memory dedupe
 * map survive across two invocations that land on the same warm serverless
 * instance — the realistic shape of a "double-fire" — rather than each
 * request getting an empty map and no in-process protection at all. Its own
 * log lines therefore use a stable logger rather than whichever request
 * happened to construct it first; every line already carries `idempotencyKey`
 * and `to`, which is enough to correlate without a request id. Tests should
 * not import this factory — construct the decorator chain directly instead
 * (e.g. `new IdempotentNotifier(new DurableIdempotentNotifier(fakeRepo,
 * fakeNotifier, logger))`), so test cases stay isolated from each other's
 * dedupe state.
 */
let singleton: Notifier | null = null;

export function createNotifier(logger: Logger, options: { dryRun?: boolean } = {}): Notifier {
  if (options.dryRun) return new PreviewNotifier(logger);

  if (!singleton) {
    const notifierLogger = createLogger().child({ component: 'notifier' });
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || 'Parity <parity@example.com>';
    const inner: Notifier = apiKey
      ? new ResendNotifier(apiKey, from, notifierLogger)
      : new LoggingNotifier(notifierLogger);
    const durable = new DurableIdempotentNotifier(new DrizzleNotificationsSentRepository(), inner, notifierLogger);
    singleton = new IdempotentNotifier(durable);
  }

  return singleton;
}
