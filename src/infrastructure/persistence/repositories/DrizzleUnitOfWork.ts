import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { savingsEvents } from '../schema';
import { cents } from '@/domain/shared/cents';
import { DrizzleBookingRepository } from './DrizzleBookingRepository';
import { DrizzleClaimRepository } from './DrizzleClaimRepository';
import { DrizzleWatchlistRepository } from './DrizzleWatchlistRepository';
import { DrizzleCreditBucketRepository } from './DrizzleCreditBucketRepository';
import { DrizzleCompetingRateRepository } from './DrizzleCompetingRateRepository';
import type { DrizzleHandle } from './drizzle-handle';
import type {
  NewSavingsEventInput,
  SavingsEventListFilter,
  SavingsEventListResult,
  SavingsEventRecord,
  SavingsEventRepository,
} from '@/application/ports/SavingsEventRepository';
import type { TransactionalRepositories, UnitOfWork } from '@/application/ports/UnitOfWork';

/**
 * Drizzle implementation of `UnitOfWork` — see `UnitOfWork.ts` for why this
 * exists. `db.transaction()` opens one Postgres transaction; every repository
 * handed to `fn` is constructed against that same `tx` handle, so every
 * statement any of them run is part of it, and a thrown error anywhere inside
 * `fn` rolls the whole thing back (Drizzle's `transaction()` already does
 * this — nothing extra to write here).
 *
 * `savingsEvents` here is a small tx-scoped implementation local to this file
 * rather than a reuse of `DrizzleSavingsEventRepository` (the one behind the
 * standalone `GET /api/ledger` route): that one is deliberately built against
 * the ambient pooled `db` client for its own read-heavy use case, and handing
 * it a foreign transaction handle is not part of its contract. Duplicating the
 * handful of lines an insert needs here is cheaper — and safer — than making
 * every repository in the app transaction-aware just for the one write this
 * class needs to be atomic with the claim status change (§5.2 #2).
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  public async run<T>(fn: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const repos: TransactionalRepositories = {
        bookings: new DrizzleBookingRepository(tx),
        claims: new DrizzleClaimRepository(tx),
        savingsEvents: new TxSavingsEventRepository(tx),
        watchlist: new DrizzleWatchlistRepository(tx),
        creditBuckets: new DrizzleCreditBucketRepository(tx),
        // Deliberately *not* transaction-scoped. This is only read here, to
        // find the competing rate a comparison was saved with in an earlier,
        // already-committed transaction — so the ambient pooled client sees
        // it and a tx handle buys nothing.
        competingRates: new DrizzleCompetingRateRepository(),
      };
      return fn(repos);
    });
  }
}

/** Just enough of `SavingsEventRepository` to run inside an open transaction. */
class TxSavingsEventRepository implements SavingsEventRepository {
  constructor(private readonly tx: DrizzleHandle) {}

  public async create(input: NewSavingsEventInput): Promise<SavingsEventRecord> {
    const [row] = await this.tx
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
    if (!row) throw new Error('Insert into savings_events returned no row.');
    return {
      id: row.id,
      userId: row.userId,
      bookingId: row.bookingId,
      claimId: row.claimId,
      kind: row.kind as SavingsEventRecord['kind'],
      amountCents: cents(row.amountCents),
      realized: row.realized,
      occurredOn: row.occurredOn,
      note: row.note,
    };
  }

  public async list(userId: string, filter: SavingsEventListFilter): Promise<SavingsEventListResult> {
    const conditions = [eq(savingsEvents.userId, userId)];
    if (filter.from) conditions.push(gte(savingsEvents.occurredOn, filter.from));
    if (filter.to) conditions.push(lte(savingsEvents.occurredOn, filter.to));
    if (filter.realized !== undefined) conditions.push(eq(savingsEvents.realized, filter.realized));

    const rows = await this.tx.select().from(savingsEvents).where(and(...conditions));
    const items = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      bookingId: row.bookingId,
      claimId: row.claimId,
      kind: row.kind as SavingsEventRecord['kind'],
      amountCents: cents(row.amountCents),
      realized: row.realized,
      occurredOn: row.occurredOn,
      note: row.note,
    }));

    const totalCents = cents(items.reduce((sum, item) => sum + item.amountCents, 0));
    const realizedCents = cents(items.filter((i) => i.realized).reduce((sum, item) => sum + item.amountCents, 0));
    return {
      items,
      aggregates: {
        totalCents,
        realizedCents,
        projectedCents: cents(totalCents - realizedCents),
        count: items.length,
      },
    };
  }
}
