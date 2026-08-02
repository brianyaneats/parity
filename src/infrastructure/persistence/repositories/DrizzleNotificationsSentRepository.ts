import { db } from '../db';
import { notificationsSent } from '../schema';
import type {
  NotificationsSentRepository,
  NotificationSentRecord,
  RecordSentInput,
} from '@/application/ports/NotificationsSentRepository';
import type { DrizzleHandle } from './drizzle-handle';

/**
 * Drizzle implementation of `NotificationsSentRepository` — the durable
 * dedup ledger behind `DurableIdempotentNotifier` (see that class's module
 * doc). `tryClaim` is the entire mechanism: `notifications_sent`'s unique
 * index on `idempotency_key` is what makes `ON CONFLICT ... DO NOTHING`
 * atomic across concurrent connections, so the row-count of what
 * `RETURNING` hands back (zero vs one) is a safe substitute for a
 * read-then-write check.
 */
export class DrizzleNotificationsSentRepository implements NotificationsSentRepository {
  constructor(private readonly handle: DrizzleHandle = db) {}

  public async tryClaim(input: RecordSentInput): Promise<NotificationSentRecord | null> {
    const rows = await this.handle
      .insert(notificationsSent)
      .values({
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        sentAt: input.sentAt,
        channel: input.channel,
      })
      .onConflictDoNothing({ target: notificationsSent.idempotencyKey })
      .returning();

    const row = rows[0];
    return row ? toRecord(row) : null;
  }
}

function toRecord(row: typeof notificationsSent.$inferSelect): NotificationSentRecord {
  return {
    id: row.id,
    userId: row.userId,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    sentAt: row.sentAt,
    channel: row.channel,
  };
}
