import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { savingsEvents } from '../schema';
import type { Cents } from '@/domain/shared/cents';
import type {
  NewSavingsEventInput,
  SavingsEventAggregates,
  SavingsEventListFilter,
  SavingsEventListResult,
  SavingsEventRecord,
  SavingsEventRepository,
} from '@/application/ports/SavingsEventRepository';

/**
 * `SavingsEventRepository` — Drizzle-backed, over `savings_events` (§4.2).
 *
 * `list()` scopes to `userId` always and layers `from`/`to`/`realized` on top
 * only when the caller actually supplied them, so an unfiltered request reads
 * every event rather than zero. Aggregates are computed by a second, cheap
 * `count`/`sum` pass over the same `WHERE` clause rather than by summing the
 * already-fetched rows in JS — the row set returned to the ledger UI may be
 * paginated later, and the totals should not depend on that.
 */
export class DrizzleSavingsEventRepository implements SavingsEventRepository {
  public async create(input: NewSavingsEventInput): Promise<SavingsEventRecord> {
    const [row] = await db
      .insert(savingsEvents)
      .values({
        userId: input.userId,
        bookingId: input.bookingId ?? null,
        claimId: input.claimId ?? null,
        kind: input.kind,
        amountCents: input.amountCents,
        realized: input.realized,
        occurredOn: input.occurredOn,
        note: input.note ?? null,
      })
      .returning();

    if (!row) {
      throw new Error('Insert into savings_events returned no row.');
    }

    return toRecord(row);
  }

  public async list(userId: string, filter: SavingsEventListFilter): Promise<SavingsEventListResult> {
    const conditions = [eq(savingsEvents.userId, userId)];
    if (filter.from !== undefined) conditions.push(gte(savingsEvents.occurredOn, filter.from));
    if (filter.to !== undefined) conditions.push(lte(savingsEvents.occurredOn, filter.to));
    if (filter.realized !== undefined) conditions.push(eq(savingsEvents.realized, filter.realized));

    const where = and(...conditions);

    const [rows, aggregateRows] = await Promise.all([
      db.select().from(savingsEvents).where(where).orderBy(desc(savingsEvents.occurredOn)),
      db
        .select({
          totalCents: sql<number>`coalesce(sum(${savingsEvents.amountCents}), 0)::int`,
          realizedCents: sql<number>`coalesce(sum(${savingsEvents.amountCents}) filter (where ${savingsEvents.realized} = true), 0)::int`,
          projectedCents: sql<number>`coalesce(sum(${savingsEvents.amountCents}) filter (where ${savingsEvents.realized} = false), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(savingsEvents)
        .where(where),
    ]);

    const aggregateRow = aggregateRows[0];
    const aggregates: SavingsEventAggregates = {
      totalCents: (aggregateRow?.totalCents ?? 0) as Cents,
      realizedCents: (aggregateRow?.realizedCents ?? 0) as Cents,
      projectedCents: (aggregateRow?.projectedCents ?? 0) as Cents,
      count: aggregateRow?.count ?? 0,
    };

    return { items: rows.map(toRecord), aggregates };
  }
}

function toRecord(row: typeof savingsEvents.$inferSelect): SavingsEventRecord {
  return {
    id: row.id,
    userId: row.userId,
    bookingId: row.bookingId,
    claimId: row.claimId,
    kind: row.kind,
    amountCents: row.amountCents as Cents,
    realized: row.realized,
    occurredOn: row.occurredOn,
    note: row.note,
  };
}
