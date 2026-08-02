import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { creditBuckets, users, userSettings, type CreditBucketRow } from '../schema';
import { cents, type Cents } from '@/domain/shared/cents';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import type { DrizzleHandle } from './drizzle-handle';
import type {
  CreditBucketRecord,
  CreditBucketRepository,
  CreditBucketSweepRow,
  NewCreditBucketInput,
} from '@/application/ports/CreditBucketRepository';

/**
 * Drizzle-backed `CreditBucketRepository` — §2.4, §4.2, §4.4.
 *
 * `upsert` is idempotent on `(userId, key, windowStart)`, matching the unique
 * constraint the seed relies on for repeatable runs.
 *
 * Accepts an optional `DrizzleHandle` — mirrors `DrizzleBookingRepository` and
 * `DrizzleClaimRepository` — so `DrizzleUnitOfWork` can hand it an open
 * transaction and the booking-records-a-bucket-consumption write (§2.4, the P0
 * fix this repository is part of) commits atomically with the booking row
 * instead of as a second, separately-failable write.
 */
export class DrizzleCreditBucketRepository implements CreditBucketRepository {
  constructor(private readonly handle: DrizzleHandle = db) {}

  public async upsert(input: NewCreditBucketInput): Promise<CreditBucketRecord> {
    const insertValues = {
      userId: input.userId,
      cardId: input.cardId ?? null,
      key: input.key,
      label: input.label,
      faceCents: input.faceCents,
      windowStart: input.window.start,
      windowEnd: input.window.end,
      consumedCents: input.consumedCents ?? 0,
    };

    const [row] = await this.handle
      .insert(creditBuckets)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [creditBuckets.userId, creditBuckets.key, creditBuckets.windowStart],
        set: {
          cardId: insertValues.cardId,
          label: insertValues.label,
          faceCents: insertValues.faceCents,
          windowEnd: insertValues.windowEnd,
          // `consumedCents` is deliberately left out of the conflict update
          // unless the caller explicitly passed one: a re-seed of the same
          // (userId, key, windowStart) bucket must not silently reset how
          // much the user has already burned. Only `setConsumedCents` is
          // meant to change it after the bucket first exists.
          ...(input.consumedCents !== undefined ? { consumedCents: input.consumedCents } : {}),
        },
      })
      .returning();

    if (!row) {
      throw new Error('Upsert into credit_buckets did not return a row.');
    }
    return toRecord(row);
  }

  public async listByUser(userId: string): Promise<readonly CreditBucketRecord[]> {
    const rows = await this.handle.select().from(creditBuckets).where(eq(creditBuckets.userId, userId));
    return rows.map(toRecord);
  }

  public async findById(id: string, userId: string): Promise<CreditBucketRecord | null> {
    const rows = await this.handle
      .select()
      .from(creditBuckets)
      .where(and(eq(creditBuckets.id, id), eq(creditBuckets.userId, userId)))
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  public async setConsumedCents(
    id: string,
    userId: string,
    consumedCents: Cents,
  ): Promise<CreditBucketRecord | null> {
    const [row] = await this.handle
      .update(creditBuckets)
      .set({ consumedCents })
      .where(and(eq(creditBuckets.id, id), eq(creditBuckets.userId, userId)))
      .returning();
    return row ? toRecord(row) : null;
  }

  public async listForExpirySweep(now: Date): Promise<readonly CreditBucketSweepRow[]> {
    const today = toIsoDate(now);

    const rows = await this.handle
      .select({
        bucket: creditBuckets,
        userEmail: users.email,
        userTimezone: userSettings.timezone,
      })
      .from(creditBuckets)
      .innerJoin(users, eq(users.id, creditBuckets.userId))
      .leftJoin(userSettings, eq(userSettings.userId, creditBuckets.userId))
      .where(
        and(
          gte(creditBuckets.windowEnd, today),
          sql`${creditBuckets.consumedCents} < ${creditBuckets.faceCents}`,
        ),
      );

    return rows.map((row) => ({
      bucket: toRecord(row.bucket),
      userEmail: row.userEmail,
      userTimezone: row.userTimezone ?? 'America/New_York',
    }));
  }
}

function toRecord(row: CreditBucketRow): CreditBucketRecord {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    key: row.key,
    label: row.label,
    faceCents: cents(row.faceCents),
    window: { start: row.windowStart, end: row.windowEnd },
    consumedCents: cents(row.consumedCents),
  };
}
