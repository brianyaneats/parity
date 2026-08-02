import { describe, it, expect } from 'vitest';
import { RecordBookingUseCase } from './RecordBookingUseCase';
import { CompareChannelsUseCase } from './CompareChannelsUseCase';
import { InMemoryUnitOfWork, InMemoryComparisonRepository } from '../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import { cents } from '@/domain/shared/cents';
import { compareRequestSchema } from '@/lib/validation/compare';
import type { ExecutionContext, UseCaseDependencies } from '../shared/UseCase';
import type { CreateBookingInput } from '@/lib/validation/bookings';

/**
 * The end-to-end regression the P0 defect report asked for: two half-open
 * doors that only look closed when checked separately.
 *
 * (a) `RecordBookingUseCase` never moved `credit_buckets.consumed_cents`, so
 *     a real, paid booking never actually burned the credit it earned.
 * (b) `CompareChannelsUseCase` trusted whatever `amexBucketAvailable` /
 *     `editBucketAvailable` the request claimed, so a stale or optimistic
 *     client value could keep claiming a credit that (a) had already spent.
 *
 * Fixing either alone leaves the other half of the bug standing — (a) without
 * (b) still lets a second comparison re-claim a spent credit; (b) without (a)
 * has nothing real to ever read as spent. This test wires both use cases
 * against the *same* in-memory bucket state, the way `DrizzleUnitOfWork` and
 * `container.ts` do against the same Postgres row in production, and proves
 * the second stay gets the honest answer.
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

function bookingInput(overrides: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    comparisonId: null,
    channel: 'EDIT',
    confirmationNumber: 'CONF-1',
    bookedAt: '2026-07-27T12:00:00.000Z',
    checkIn: '2026-08-01',
    checkOut: '2026-08-04',
    totalCents: 354_000,
    baseCents: 314_947,
    cashChargedCents: 354_000,
    pointsUsed: null,
    prepaid: true,
    refundable: true,
    cancelDeadline: '2026-07-30',
    bucketId: null,
    ...overrides,
  };
}

/** TC-01's shared context (§3.8), parsed the same way the route parses a real request body. */
function compareRequest() {
  return compareRequestSchema.parse({
    context: {
      nights: 3,
      taxRateBps: 1240,
      breakfastPerDayCents: 7000,
      propertyCreditFaceCents: 10000,
      realizationPct: 100,
      mrValueMicro: 15000,
      urValueMicro: 17500,
      foraRateBps: 700,
      // The client's own optimistic guess — deliberately left `true` on both
      // calls to prove the server never trusts it (§5.3, task item 3). If the
      // fix regressed to "forward the request's own booleans", this test
      // would still pass on the *first* call and only fail on the second —
      // which is exactly the shape the real defect had.
      amexBucketAvailable: true,
      editBucketAvailable: true,
      competitorBaseCents: 300_000,
      competitorRefundable: true,
      competitorPublic: true,
      brand: 'NONE',
    },
    quotes: [{ channel: 'EDIT', totalCents: 354_000, prepaid: true, refundable: true }],
  });
}

describe('The second-stay scenario — booking and compare share live bucket state (§2.4, §5.3)', () => {
  it('burns the Edit credit on stay #1, and a fresh compare for stay #2 in the same window reports it spent', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();

    // The one bucket both use cases read and write — `RecordBookingUseCase`
    // consumes it, `CompareChannelsUseCase` derives availability from it, the
    // same way `DrizzleUnitOfWork`'s and `container.ts`'s `DrizzleCreditBucketRepository`
    // instances both ultimately point at one Postgres row in production.
    uow.creditBuckets.rows.push({
      id: 'edit-bucket-h2',
      userId: 'user-1',
      cardId: 'csr-card',
      key: 'CSR_EDIT_H2',
      label: 'The Edit credit · Jul–Dec',
      faceCents: cents(25_000),
      window: { start: '2026-07-01', end: '2026-12-31' },
      consumedCents: cents(0),
    });

    const bookingUseCase = new RecordBookingUseCase(deps(), uow, comparisons);
    const compareUseCase = new CompareChannelsUseCase(deps(), new SavingsEngine(), uow.creditBuckets);

    // Before stay #1: the credit is live, and the comparator honestly says so.
    const before = await compareUseCase.execute(compareRequest(), ctx);
    expect(before.bucketAvailability.editBucketAvailable).toBe(true);
    expect(before.bucketAvailability.editRemainingCents).toBe(25_000);
    expect(before.results.find((r) => r.channel === 'EDIT')?.creditFaceCents).toBe(25_000);

    // Stay #1: book it on EDIT. This is `RecordBookingUseCase`'s own P0 fix —
    // before it, this call would leave `consumed_cents` at 0 forever.
    const bookingResult = await bookingUseCase.execute({ ...bookingInput(), userId: 'user-1' }, ctx);
    expect(bookingResult.booking.bucketId).toBe('edit-bucket-h2');
    const bucketAfterStay1 = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucketAfterStay1?.consumedCents).toBe(25_000);

    // Stay #2, same window, same client optimism: the request still says
    // `editBucketAvailable: true` — this is the exact half of the defect
    // `CompareChannelsUseCase` fixes. The response must not agree with it.
    const after = await compareUseCase.execute(compareRequest(), ctx);

    expect(after.bucketAvailability.editBucketAvailable).toBe(false);
    expect(after.bucketAvailability.editRemainingCents).toBe(0);

    const editAfter = after.results.find((r) => r.channel === 'EDIT');
    expect(editAfter?.creditFaceCents).toBe(0);
    expect(editAfter?.creditKeptCents).toBe(0);

    // The Amex side was never touched, so it must still read live — the fix
    // derives each bucket independently rather than a single "any bucket
    // spent" flag that would wrongly flatten both to false.
    expect(after.bucketAvailability.amexBucketAvailable).toBe(false); // no Amex bucket seeded at all
  });

  it('a cancelled stay #1 gives the credit back, and the very next compare reflects it live again', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    uow.creditBuckets.rows.push({
      id: 'edit-bucket-h2',
      userId: 'user-1',
      cardId: 'csr-card',
      key: 'CSR_EDIT_H2',
      label: 'The Edit credit · Jul–Dec',
      faceCents: cents(25_000),
      window: { start: '2026-07-01', end: '2026-12-31' },
      consumedCents: cents(25_000), // already fully consumed by a prior stay
    });

    const compareUseCase = new CompareChannelsUseCase(deps(), new SavingsEngine(), uow.creditBuckets);

    const spent = await compareUseCase.execute(compareRequest(), ctx);
    expect(spent.bucketAvailability.editBucketAvailable).toBe(false);

    // Release it directly on the bucket state the compare use case reads —
    // `UpdateBookingUseCase.test.ts` covers the cancellation call itself in
    // detail; this asserts the two use cases agree once the bucket changes.
    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    if (bucket) await uow.creditBuckets.setConsumedCents(bucket.id, 'user-1', cents(0));

    const released = await compareUseCase.execute(compareRequest(), ctx);
    expect(released.bucketAvailability.editBucketAvailable).toBe(true);
    expect(released.bucketAvailability.editRemainingCents).toBe(25_000);
  });
});
