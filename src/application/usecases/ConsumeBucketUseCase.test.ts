import { describe, it, expect } from 'vitest';
import { ConsumeBucketUseCase } from './ConsumeBucketUseCase';
import { InMemoryCreditBucketRepository, InMemorySavingsEventRepository } from '../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import { cents } from '@/domain/shared/cents';
import type { ExecutionContext, UseCaseDependencies } from '../shared/UseCase';

/**
 * §2.4 / the P1 ledger fix: `CREDIT_BURNED` was declared in
 * `src/domain/ledger/SavingsEvent.ts` with zero producers. This is that
 * event's first real producer — see `ConsumeBucketUseCase`'s doc comment for
 * why it lives here (the one *actual* consumption code path today) and for
 * the coordination note about automatic booking-time consumption landing
 * separately.
 */

function deps(): UseCaseDependencies & { logger: MemoryLogger; metrics: MetricsRegistry } {
  return {
    logger: new MemoryLogger(),
    metrics: new MetricsRegistry({ now: () => 0 }),
    clock: new FixedClock('2026-07-27T12:00:00Z'),
  };
}

const ctx: ExecutionContext = {
  userId: 'user-1',
  requestId: 'req-1',
  now: new Date('2026-07-27T12:00:00Z'),
};

async function seedBucket(buckets: InMemoryCreditBucketRepository, faceCents = 30_000) {
  return buckets.upsert({
    userId: 'user-1',
    key: 'AMEX_HOTEL_H2',
    label: 'Amex Hotel Credit (H2)',
    faceCents: cents(faceCents),
    window: { start: '2026-07-01', end: '2026-12-31' },
  });
}

describe('ConsumeBucketUseCase — CREDIT_BURNED savings event', () => {
  it('writes a realized CREDIT_BURNED event traceable to the booking when a bookingId is supplied', async () => {
    const buckets = new InMemoryCreditBucketRepository();
    const savingsEvents = new InMemorySavingsEventRepository();
    const bucket = await seedBucket(buckets);
    const useCase = new ConsumeBucketUseCase(deps(), buckets, savingsEvents);

    await useCase.execute(
      { bucketId: bucket.id, amountCents: 30_000, bookingId: 'booking-1', userId: 'user-1' },
      ctx,
    );

    expect(savingsEvents.rows).toHaveLength(1);
    const event = savingsEvents.rows[0];
    expect(event?.kind).toBe('CREDIT_BURNED');
    expect(event?.realized).toBe(true);
    expect(event?.bookingId).toBe('booking-1');
    expect(event?.amountCents).toBe(30_000);
  });

  it('caps the event at what the bucket actually had remaining, not the requested amount', async () => {
    const buckets = new InMemoryCreditBucketRepository();
    const savingsEvents = new InMemorySavingsEventRepository();
    const bucket = await seedBucket(buckets, 10_000);
    const useCase = new ConsumeBucketUseCase(deps(), buckets, savingsEvents);

    await useCase.execute(
      { bucketId: bucket.id, amountCents: 30_000, bookingId: 'booking-1', userId: 'user-1' },
      ctx,
    );

    expect(savingsEvents.rows[0]?.amountCents).toBe(10_000);
  });

  it('writes no event when there is no bookingId to trace it to — a realized saving must name its source', async () => {
    const buckets = new InMemoryCreditBucketRepository();
    const savingsEvents = new InMemorySavingsEventRepository();
    const bucket = await seedBucket(buckets);
    const useCase = new ConsumeBucketUseCase(deps(), buckets, savingsEvents);

    await useCase.execute({ bucketId: bucket.id, amountCents: 30_000, userId: 'user-1' }, ctx);

    expect(savingsEvents.rows).toHaveLength(0);
  });

  it('writes no event when the bucket was already exhausted', async () => {
    const buckets = new InMemoryCreditBucketRepository();
    const savingsEvents = new InMemorySavingsEventRepository();
    const bucket = await seedBucket(buckets, 10_000);
    const useCase = new ConsumeBucketUseCase(deps(), buckets, savingsEvents);
    await useCase.execute(
      { bucketId: bucket.id, amountCents: 10_000, bookingId: 'booking-1', userId: 'user-1' },
      ctx,
    );
    savingsEvents.rows.length = 0; // clear the first event so we isolate the second call

    await useCase.execute(
      { bucketId: bucket.id, amountCents: 5_000, bookingId: 'booking-2', userId: 'user-1' },
      ctx,
    );

    expect(savingsEvents.rows).toHaveLength(0);
  });
});
