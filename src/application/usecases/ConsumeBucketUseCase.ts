import type { Logger } from '@/infrastructure/observability/Logger';
import type { CreditBucketRepository } from '@/application/ports/CreditBucketRepository';
import type { SavingsEventRepository } from '@/application/ports/SavingsEventRepository';
import type { ConsumeBucketInput as ConsumeBucketPayload } from '@/lib/validation/buckets';
import { ApiError } from '@/lib/api/errors';
import { cents, type Cents } from '@/domain/shared/cents';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';
import { toBucketView, toCreditBucketAggregate, type CreditBucketView } from '../mappers/credit-bucket-mapper';

export interface ConsumeBucketInput extends ConsumeBucketPayload {
  readonly userId: string;
}

/**
 * `POST /api/buckets` — §2.4.
 *
 * Loads the bucket, rehydrates the `CreditBucket` aggregate, records the real
 * consumption on it (capped at what remains — the aggregate's own rule, not
 * re-derived here), and persists the resulting `consumedCents`.
 *
 * **This is also, today, the ledger's only `CREDIT_BURNED` producer** — a P1
 * fix (see the task this shipped under: `savings_events.kind = 'CREDIT_BURNED'`
 * was declared in the domain with zero producers). `CreditBucket.consume()`
 * already raises a `credit.consumed` domain event carrying `appliedCents` and
 * an optional `bookingId`, the same "aggregate records what happened, the use
 * case drains and reacts" pattern `Booking.record()` uses for its auto-claim —
 * so this drains it and writes a realized event for the amount actually
 * applied (never the requested amount, which the aggregate may have capped at
 * what remained).
 *
 * A `bookingId` is required to write the event because `SavingsEvent`'s own
 * invariant is that **a realized saving must reference the booking or claim
 * it came from** (§1.5 #4's audit trail) — `savings_events` has no
 * `bucket_id` column to fall back on. A manual consumption logged with no
 * `bookingId` still updates the bucket (the §2.4 arithmetic does not need
 * one) but leaves no ledger entry, which is the conservative choice per
 * §0.3.3: an untraceable "realized" figure would fail the audit criterion
 * worse than a missing one.
 *
 * **Coordination note for whoever wires automatic bucket consumption into
 * `RecordBookingUseCase`** (tracked separately, concurrent with this fix):
 * route that consumption through this use case, or duplicate this exact
 * event-writing shape, rather than adding a second `CREDIT_BURNED` producer —
 * two producers for the same bucket hit would double-count it in the ledger.
 */
export class ConsumeBucketUseCase extends CommandUseCase<ConsumeBucketInput, CreditBucketView> {
  public readonly name = 'consume_bucket';

  constructor(
    deps: UseCaseDependencies,
    private readonly creditBucketRepository: CreditBucketRepository,
    private readonly savingsEventRepository: SavingsEventRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: ConsumeBucketInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<CreditBucketView> {
    const record = await this.creditBucketRepository.findById(input.bucketId, input.userId);
    if (!record) throw ApiError.notFound('Credit bucket');

    const bucket = toCreditBucketAggregate(record);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : ctx.now;
    bucket.consume(cents(input.amountCents), occurredAt, input.bookingId);

    // Drained before the persistence call, matching `Booking.record()`'s own
    // "read once, up front" comment — `pullDomainEvents()` clears the buffer.
    const events = bucket.pullDomainEvents();

    const updated = await this.creditBucketRepository.setConsumedCents(
      input.bucketId,
      input.userId,
      bucket.consumedCents,
    );
    if (!updated) throw ApiError.notFound('Credit bucket');

    for (const event of events) {
      if (event.type !== 'credit.consumed') continue;

      const appliedCents = event.payload.appliedCents as Cents;
      // Nothing was actually applied (the bucket was already exhausted) —
      // no phantom saving belongs in the ledger.
      if (appliedCents <= 0) continue;

      const eventBookingId = typeof event.payload.bookingId === 'string' ? event.payload.bookingId : null;
      if (!eventBookingId) continue; // see the class doc comment — no traceable source, no event.

      await this.savingsEventRepository.create({
        userId: input.userId,
        bookingId: eventBookingId,
        kind: 'CREDIT_BURNED',
        amountCents: appliedCents,
        realized: true,
        occurredOn: toIsoDate(occurredAt),
        note: `Burned ${bucket.label} (${bucket.key}).`,
      });

      this.deps.metrics.increment('credit.burned_recorded', { key: bucket.key });
      logger.info('credit consumption recorded a realized savings event', {
        bucketId: bucket.id,
        bookingId: eventBookingId,
        appliedCents,
      });
    }

    return toBucketView(toCreditBucketAggregate(updated), toIsoDate(ctx.now));
  }

  protected override describeInput(input: ConsumeBucketInput) {
    return { bucketId: input.bucketId, amountCents: input.amountCents };
  }
}
