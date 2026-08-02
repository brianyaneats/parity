import { describe, it, expect } from 'vitest';
import { UpdateBookingUseCase } from './UpdateBookingUseCase';
import {
  InMemoryBookingRepository,
  InMemoryWatchlistRepository,
  InMemoryCreditBucketRepository,
} from '../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock, addDays } from '@/domain/shared/Clock';
import { cents } from '@/domain/shared/cents';
import type { ExecutionContext, UseCaseDependencies } from '../shared/UseCase';
import type { NewBookingInput } from '@/application/ports/BookingRepository';

/**
 * A bare `InMemoryCreditBucketRepository` — every test here books with
 * `bucketId: null`, so `UpdateBookingUseCase`'s bucket-release branch
 * (`releasesBucket` is `null` when a booking was never assigned one) never
 * calls into it. Constructed once per test purely to satisfy the
 * constructor; the watchlist-deactivation behaviour under test is
 * independent of it.
 */
function noBuckets(): InMemoryCreditBucketRepository {
  return new InMemoryCreditBucketRepository();
}

/**
 * §7.6: "Cancelling or completing a booking must deactivate its watchlist
 * row — a reminder to re-shop a stay you already took is worse than no
 * reminder." This is the P1 fix's other half — `RecordBookingUseCase.test.ts`
 * covers row *creation*; this covers deactivation on the two terminal
 * transitions.
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

async function seedActiveRefundableBooking(
  bookings: InMemoryBookingRepository,
  watchlist: InMemoryWatchlistRepository,
): Promise<{ bookingId: string }> {
  const input: NewBookingInput = {
    id: 'booking-1',
    userId: 'user-1',
    comparisonId: null,
    channel: 'EDIT',
    confirmationNumber: 'CONF-1',
    bookedAt: new Date('2026-07-27T12:00:00Z'),
    checkIn: '2026-08-01',
    checkOut: '2026-08-04',
    totalCents: cents(354_000),
    baseCents: cents(314_947),
    cashChargedCents: cents(354_000),
    pointsUsed: null,
    refundable: true,
    cancelDeadline: '2026-07-30',
    bucketId: null,
    status: 'ACTIVE',
  };
  const booking = await bookings.create(input);
  await watchlist.create({
    userId: 'user-1',
    bookingId: booking.id,
    cadenceDays: 7,
    nextCheckAt: addDays(ctx.now, 7),
  });
  return { bookingId: booking.id };
}

describe('UpdateBookingUseCase — §7.6 watchlist deactivation', () => {
  it('deactivates the watchlist row when a booking is cancelled', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const { bookingId } = await seedActiveRefundableBooking(bookings, watchlist);
    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, noBuckets());

    await useCase.execute({ id: bookingId, userId: 'user-1', status: 'CANCELLED' }, ctx);

    expect(watchlist.rows).toHaveLength(1);
    expect(watchlist.rows[0]?.active).toBe(false);
  });

  it('deactivates the watchlist row when a booking is completed', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const { bookingId } = await seedActiveRefundableBooking(bookings, watchlist);
    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, noBuckets());

    await useCase.execute({ id: bookingId, userId: 'user-1', status: 'COMPLETED' }, ctx);

    expect(watchlist.rows).toHaveLength(1);
    expect(watchlist.rows[0]?.active).toBe(false);
  });

  it('does not touch the watchlist on an update that is not a status transition', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const { bookingId } = await seedActiveRefundableBooking(bookings, watchlist);
    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, noBuckets());

    await useCase.execute({ id: bookingId, userId: 'user-1', confirmationNumber: 'CONF-2' }, ctx);

    expect(watchlist.rows[0]?.active).toBe(true);
  });

  it('is a no-op, not an error, when the booking never had a watchlist row', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const booking = await bookings.create({
      id: 'booking-2',
      userId: 'user-1',
      comparisonId: null,
      channel: 'FHR',
      confirmationNumber: null,
      bookedAt: new Date('2026-07-27T12:00:00Z'),
      checkIn: '2026-08-01',
      checkOut: '2026-08-02',
      totalCents: cents(100_000),
      baseCents: cents(90_000),
      cashChargedCents: cents(100_000),
      pointsUsed: null,
      refundable: false,
      cancelDeadline: null,
      bucketId: null,
      status: 'ACTIVE',
    });
    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, noBuckets());

    const result = await useCase.execute({ id: booking.id, userId: 'user-1', status: 'CANCELLED' }, ctx);

    expect(result.status).toBe('CANCELLED');
    expect(watchlist.rows).toHaveLength(0);
  });
});

/**
 * §2.4, task item 2 — the other half of the P0 fix this file's sibling test
 * (`RecordBookingUseCase.test.ts`) covers consumption for: cancelling a
 * booking must give its credit back, or a bucket that was fully consumed by a
 * since-cancelled stay would read as spent for the rest of its window even
 * though the user never actually kept the money.
 */
describe('UpdateBookingUseCase — §2.4 credit-bucket release on cancellation', () => {
  const BUCKET_WINDOW = { start: '2026-07-01', end: '2026-12-31' };

  function seedBucket(
    creditBuckets: InMemoryCreditBucketRepository,
    overrides: Partial<{ id: string; faceCents: number; consumedCents: number }> = {},
  ): string {
    const id = overrides.id ?? 'bucket-1';
    creditBuckets.rows.push({
      id,
      userId: 'user-1',
      cardId: null,
      key: 'CSR_EDIT_H2',
      label: 'The Edit credit · Jul–Dec',
      faceCents: cents(overrides.faceCents ?? 25_000),
      window: BUCKET_WINDOW,
      consumedCents: cents(overrides.consumedCents ?? 25_000),
    });
    return id;
  }

  async function seedBookingWithBucket(
    bookings: InMemoryBookingRepository,
    bucketId: string,
    cashChargedCents: number,
  ): Promise<string> {
    const booking = await bookings.create({
      id: 'booking-with-bucket',
      userId: 'user-1',
      comparisonId: null,
      channel: 'EDIT',
      confirmationNumber: 'CONF-1',
      bookedAt: new Date('2026-07-27T12:00:00Z'),
      checkIn: '2026-08-01',
      checkOut: '2026-08-04',
      totalCents: cents(cashChargedCents),
      baseCents: cents(Math.round(cashChargedCents * 0.9)),
      cashChargedCents: cents(cashChargedCents),
      pointsUsed: null,
      refundable: true,
      cancelDeadline: '2026-07-30',
      bucketId,
      status: 'ACTIVE',
    });
    return booking.id;
  }

  it('releases the full amount back to a bucket the cancelled booking had fully consumed', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const creditBuckets = new InMemoryCreditBucketRepository();
    const bucketId = seedBucket(creditBuckets, { faceCents: 25_000, consumedCents: 25_000 });
    const bookingId = await seedBookingWithBucket(bookings, bucketId, 25_000);

    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, creditBuckets);
    await useCase.execute({ id: bookingId, userId: 'user-1', status: 'CANCELLED' }, ctx);

    const bucket = creditBuckets.rows.find((row) => row.id === bucketId);
    expect(bucket?.consumedCents).toBe(0);
  });

  it('releases only the partial amount a clawed-back booking actually kept', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const creditBuckets = new InMemoryCreditBucketRepository();
    // TC-05-shaped: the booking only ever kept $177.63 of the $250 face.
    const bucketId = seedBucket(creditBuckets, { faceCents: 25_000, consumedCents: 17_763 });
    const bookingId = await seedBookingWithBucket(bookings, bucketId, 17_763);

    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, creditBuckets);
    await useCase.execute({ id: bookingId, userId: 'user-1', status: 'CANCELLED' }, ctx);

    const bucket = creditBuckets.rows.find((row) => row.id === bucketId);
    expect(bucket?.consumedCents).toBe(0);
  });

  it('never releases more than the bucket currently holds — another booking may have drawn on it since', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const creditBuckets = new InMemoryCreditBucketRepository();
    // The bucket only shows $50 as currently consumed even though this
    // booking's own net charge implies $250 (e.g. some other adjustment
    // already reduced it) — `CreditBucket.release()` caps the release at
    // what is actually marked consumed, never driving it negative.
    const bucketId = seedBucket(creditBuckets, { faceCents: 25_000, consumedCents: 5_000 });
    const bookingId = await seedBookingWithBucket(bookings, bucketId, 25_000);

    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, creditBuckets);
    await useCase.execute({ id: bookingId, userId: 'user-1', status: 'CANCELLED' }, ctx);

    const bucket = creditBuckets.rows.find((row) => row.id === bucketId);
    expect(bucket?.consumedCents).toBe(0);
  });

  it('is a no-op, not an error, when the booking was never assigned a bucket', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const creditBuckets = new InMemoryCreditBucketRepository();
    const { bookingId } = await seedActiveRefundableBooking(bookings, watchlist);

    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, creditBuckets);
    const result = await useCase.execute({ id: bookingId, userId: 'user-1', status: 'CANCELLED' }, ctx);

    expect(result.status).toBe('CANCELLED');
    expect(creditBuckets.rows).toHaveLength(0);
  });

  it('does not release a bucket when the booking is completed rather than cancelled', async () => {
    const bookings = new InMemoryBookingRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const creditBuckets = new InMemoryCreditBucketRepository();
    const bucketId = seedBucket(creditBuckets, { faceCents: 25_000, consumedCents: 25_000 });
    const bookingId = await seedBookingWithBucket(bookings, bucketId, 25_000);

    const useCase = new UpdateBookingUseCase(deps(), bookings, watchlist, creditBuckets);
    await useCase.execute({ id: bookingId, userId: 'user-1', status: 'COMPLETED' }, ctx);

    const bucket = creditBuckets.rows.find((row) => row.id === bucketId);
    expect(bucket?.consumedCents).toBe(25_000);
  });
});
