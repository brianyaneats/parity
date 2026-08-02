import { Booking } from '@/domain/booking/Booking';
import { cents } from '@/domain/shared/cents';
import { ApiError } from '@/lib/api/errors';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { BookingPatchInput } from '@/lib/validation/bookings';
import type { BookingRecord, BookingRepository } from '@/application/ports/BookingRepository';
import type { WatchlistRepository } from '@/application/ports/WatchlistRepository';
import type { CreditBucketRepository } from '@/application/ports/CreditBucketRepository';
import { toBookingProps } from '../mappers/booking-mapper';
import { toCreditBucketAggregate } from '../mappers/credit-bucket-mapper';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface UpdateBookingInput extends BookingPatchInput {
  readonly id: string;
  readonly userId: string;
}

/**
 * `PATCH /api/bookings/:id` — §5.2.
 *
 * Rehydrates the `Booking` aggregate so a status change goes through its
 * transition table (`ACTIVE → CANCELLED|COMPLETED`) rather than being written
 * directly — the same "one place owns the rule" discipline §7.4 applies to
 * `Claim`.
 *
 * §7.6: "Cancelling or completing a booking must deactivate its watchlist
 * row — a reminder to re-shop a stay you already took is worse than no
 * reminder." `booking.transitionTo` already raises a `booking.cancelled` or
 * `booking.completed` domain event; this drains it and reacts, the same
 * "domain event drives the cross-aggregate side effect" pattern
 * `RecordBookingUseCase` uses for the auto-claim and the watchlist row it
 * creates. Not run inside a `UnitOfWork` transaction with the booking update
 * — unlike `RecordBookingUseCase`'s writes, this use case predates any
 * transactional need and adding one here is a larger change than this fix
 * warrants; the failure mode of the two writes landing non-atomically is a
 * stray reminder for an already-cancelled trip, not a missed one, which is
 * the direction §7.6's own warning cares about.
 *
 * **§2.4, task item 2 — release on cancellation.** `booking.cancelled`'s event
 * payload already carries `releasesBucket` (the bucket id the booking was
 * assigned to, or `null`); before this fix nothing ever read it, so a
 * cancelled booking permanently forfeited whatever it had consumed for the
 * rest of that bucket's window. This reacts to it the same way as the
 * watchlist deactivation above, non-transactionally, for the identical
 * reason given for that one — with the same accepted risk direction: a
 * process death between the status write and the release write leaves a
 * credit *stuck as consumed* rather than double-released, which is the
 * conservative failure mode (§0.3 item 3).
 *
 * A cancelled booking does not persist how much of the bucket it individually
 * consumed (`bookings` has no such column — §4.2). The amount released is
 * recomputed the same way `RecordBookingUseCase` computed it at consumption
 * time (the booking's own net cash charged); `CreditBucket.release()` caps at
 * what the bucket currently holds, so this can never over-release even if
 * another booking has since drawn on the same bucket. SPEC-GAP, logged per
 * §0.3 item 3.
 */
export class UpdateBookingUseCase extends CommandUseCase<UpdateBookingInput, BookingRecord> {
  public readonly name = 'update_booking';

  constructor(
    deps: UseCaseDependencies,
    private readonly bookings: BookingRepository,
    private readonly watchlistRepository: WatchlistRepository,
    private readonly creditBucketRepository: CreditBucketRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: UpdateBookingInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<BookingRecord> {
    const record = await this.bookings.findById(input.id, input.userId);
    if (!record) throw ApiError.notFound('Booking');

    const booking = Booking.rehydrate(toBookingProps(record));

    if (input.cashChargedCents !== undefined || input.pointsUsed !== undefined) {
      booking.recordPaymentSplit(
        cents(input.cashChargedCents ?? record.cashChargedCents ?? 0),
        input.pointsUsed ?? record.pointsUsed ?? 0,
        ctx.now,
      );
    }
    if (input.confirmationNumber !== undefined && input.confirmationNumber !== null) {
      booking.recordConfirmation(input.confirmationNumber, ctx.now);
    }
    if (input.bucketId !== undefined && input.bucketId !== null) {
      booking.assignBucket(input.bucketId, ctx.now);
    }
    if (input.status !== undefined && input.status !== booking.status) {
      booking.transitionTo(input.status, ctx.now);
    }

    const events = booking.pullDomainEvents();

    const updated = await this.bookings.update(input.id, input.userId, {
      confirmationNumber: input.confirmationNumber !== undefined ? input.confirmationNumber : undefined,
      cashChargedCents: booking.cashChargedCents,
      pointsUsed: booking.pointsUsed,
      bucketId: booking.bucketId,
      status: booking.status,
    });
    if (!updated) throw ApiError.notFound('Booking');

    for (const event of events) {
      if (event.type !== 'booking.cancelled' && event.type !== 'booking.completed') continue;

      const deactivated = await this.watchlistRepository.deactivateForBooking(input.id, input.userId);
      if (deactivated) {
        this.deps.metrics.increment('booking.watchlist_deactivated', { reason: event.type });
        logger.info('booking status change deactivated its watchlist row', {
          bookingId: input.id,
          reason: event.type,
        });
      }

      if (event.type !== 'booking.cancelled') continue;

      // §2.4, task item 2: give the credit back. `releasesBucket` is `null`
      // when the booking was never assigned a bucket in the first place —
      // nothing to release, not an error.
      const releasedBucketId = event.payload.releasesBucket;
      if (typeof releasedBucketId !== 'string') continue;

      const bucketRecord = await this.creditBucketRepository.findById(releasedBucketId, input.userId);
      if (!bucketRecord) continue; // defensive: bucket no longer exists

      const bucketAggregate = toCreditBucketAggregate(bucketRecord);
      const releasedCents = bucketAggregate.release(booking.netChargeAfterRefund(cents(0)), ctx.now);
      await this.creditBucketRepository.setConsumedCents(
        releasedBucketId,
        input.userId,
        bucketAggregate.consumedCents,
      );

      this.deps.metrics.increment('booking.bucket_released', { key: bucketAggregate.key });
      logger.info('cancellation released a credit bucket', {
        bookingId: input.id,
        bucketId: releasedBucketId,
        releasedCents,
        remainingCents: bucketAggregate.remainingCents,
      });
    }

    return updated;
  }
}
