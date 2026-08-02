import { describe, it, expect } from 'vitest';
import { RecordBookingUseCase } from './RecordBookingUseCase';
import {
  InMemoryUnitOfWork,
  InMemoryComparisonRepository,
  InMemoryCreditBucketRepository,
} from '../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock, addDays } from '@/domain/shared/Clock';
import { cents } from '@/domain/shared/cents';
import { SavingsEvent, totalsFor } from '@/domain/ledger/SavingsEvent';
import { ApiError } from '@/lib/api/errors';
import type { ExecutionContext, UseCaseDependencies } from '../shared/UseCase';
import type { CreateBookingInput } from '@/lib/validation/bookings';
import type { ChannelResult } from '@/domain/engine/types';
import type { SavingsEventRecord } from '@/application/ports/SavingsEventRepository';
import type { CreditBucketRecord } from '@/application/ports/CreditBucketRepository';

/**
 * `totalsFor` (and the rest of `domain/ledger/SavingsEvent.ts`) operates on
 * the `SavingsEvent` domain value object, not the `SavingsEventRepository`
 * port's plain `SavingsEventRecord` row shape — two genuinely different
 * types (the VO also carries `label`, `equals`, …). Bridges one row at the
 * boundary rather than casting, the same conversion a real `/api/ledger`
 * read path would need to do before calling into this module.
 */
function toSavingsEvent(record: SavingsEventRecord): SavingsEvent {
  return SavingsEvent.create({
    id: record.id,
    userId: record.userId,
    kind: record.kind,
    amountCents: record.amountCents,
    realized: record.realized,
    occurredOn: record.occurredOn,
    bookingId: record.bookingId,
    claimId: record.claimId,
    note: record.note,
  });
}

/**
 * §5.2 load-bearing behaviour #1: "if the channel is EDIT or CHASE_TRAVEL and
 * the booking is prepaid, auto-create a `claims` row with
 * `deadline_at = booked_at + 24h`, status ELIGIBLE." Tested here against
 * in-memory port fakes — §10.2/the task brief: no live database required.
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

function baseInput(overrides: Partial<CreateBookingInput> = {}): CreateBookingInput {
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

/**
 * Minimal-but-valid `ChannelResult` fixture — only the fields a test cares
 * about need overriding. `totalCents` (the sticker figure the cash-only
 * `CHANNEL_CHOICE` formula now reads) is required; `effectiveNetCents`
 * defaults to zero since most tests below deliberately no longer depend on
 * it — see `channelChoiceEvent`'s doc comment for why.
 */
function channelResult(
  overrides: Partial<ChannelResult> & Pick<ChannelResult, 'channel' | 'totalCents'>,
): ChannelResult {
  return {
    quoteIndex: 0,
    label: overrides.channel,
    baseCents: cents(0),
    taxCents: cents(0),
    perksCents: cents(0),
    breakfastCents: cents(0),
    propertyCreditCents: cents(0),
    creditFaceCents: cents(0),
    creditKeptCents: cents(0),
    clawbackCents: cents(0),
    pointsValueCents: cents(0),
    pointsEarned: 0,
    refundCents: cents(0),
    rebateCents: cents(0),
    effectiveNetCents: cents(0),
    effectiveNightlyCents: cents(0),
    prepaid: true,
    refundable: true,
    priceMatch: {
      channelEligible: false,
      failedConditions: [],
      gapCents: cents(0),
      perNightCents: cents(0),
      qualifies: false,
      estimatedRefundCents: cents(0),
      minCashFloorCents: cents(0),
    },
    warnings: [],
    ...overrides,
  };
}

describe('RecordBookingUseCase — §5.2 auto-claim side effect', () => {
  it('opens a CHASE_PM claim with deadline = bookedAt + 24h for a prepaid Edit booking', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute({ ...baseInput(), userId: 'user-1' }, ctx);

    expect(result.claim).not.toBeNull();
    expect(result.claim?.status).toBe('ELIGIBLE');
    expect(result.claim?.kind).toBe('CHASE_PM');
    expect(result.claim?.bookingId).toBe(result.booking.id);
    expect(result.claim?.deadlineAt.toISOString()).toBe('2026-07-28T12:00:00.000Z');

    // Both rows actually landed in the "same transaction" (the in-memory
    // fakes bundle) — not just returned in the response.
    expect(uow.bookings.rows).toHaveLength(1);
    expect(uow.claims.rows).toHaveLength(1);
  });

  it('opens a claim for CHASE_TRAVEL too — the second price-matchable channel', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute(
      { ...baseInput({ channel: 'CHASE_TRAVEL' }), userId: 'user-1' },
      ctx,
    );

    expect(result.claim?.kind).toBe('CHASE_PM');
    expect(uow.claims.rows).toHaveLength(1);
  });

  it('opens no claim for FHR — not price-matchable, regardless of prepaid', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute(
      { ...baseInput({ channel: 'FHR' }), userId: 'user-1' },
      ctx,
    );

    expect(result.claim).toBeNull();
    expect(uow.claims.rows).toHaveLength(0);
    expect(uow.bookings.rows).toHaveLength(1); // the booking itself still commits
  });

  it('opens no claim for a pay-at-property Edit booking — prepaid is required too', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute(
      { ...baseInput({ prepaid: false }), userId: 'user-1' },
      ctx,
    );

    expect(result.claim).toBeNull();
    expect(uow.claims.rows).toHaveLength(0);
  });

  it('rejects a comparisonId that does not belong to the caller', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    // Owned by a different user.
    const foreign = await comparisons.create({
      userId: 'someone-else',
      propertyNameSnapshot: 'Not yours',
      checkIn: '2026-08-01',
      checkOut: '2026-08-02',
      nights: 1,
      taxRateBps: 0,
      contextSnapshot: {} as never,
      resultSnapshot: [],
      engineVersion: '1.0.0',
      quotes: [],
    });

    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    await expect(
      useCase.execute({ ...baseInput({ comparisonId: foreign.id }), userId: 'user-1' }, ctx),
    ).rejects.toThrow(ApiError);
    expect(uow.bookings.rows).toHaveLength(0);
  });
});

/**
 * The P1 fix this test suite exists to guard: `/watchlist` was permanently
 * empty because nothing ever created a `watchlist` row. §7.6: only a
 * refundable booking with a future cancellation deadline qualifies —
 * `Booking.isReshoppable` is the single source of truth for that, reused
 * here rather than re-derived.
 */
describe('RecordBookingUseCase — §7.6 watchlist side effect', () => {
  it('creates an active watchlist row with a correct next_check_at for a refundable booking with a future cancellation deadline', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute(
      { ...baseInput({ refundable: true, cancelDeadline: '2026-07-30' }), userId: 'user-1' },
      ctx,
    );

    expect(uow.watchlist.rows).toHaveLength(1);
    const row = uow.watchlist.rows[0];
    expect(row?.bookingId).toBe(result.booking.id);
    expect(row?.userId).toBe('user-1');
    expect(row?.active).toBe(true);
    expect(row?.cadenceDays).toBe(7);
    // ctx.now (2026-07-27T12:00:00Z) + 7 days, exactly — the first re-shop check.
    expect(row?.nextCheckAt.toISOString()).toBe(addDays(ctx.now, 7).toISOString());
  });

  it('does not watchlist a non-refundable booking', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    await useCase.execute(
      { ...baseInput({ refundable: false, cancelDeadline: '2026-07-30' }), userId: 'user-1' },
      ctx,
    );

    expect(uow.watchlist.rows).toHaveLength(0);
  });

  it('does not watchlist a refundable booking whose cancellation deadline has already passed', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    await useCase.execute(
      { ...baseInput({ refundable: true, cancelDeadline: '2026-07-26' }), userId: 'user-1' },
      ctx,
    );

    expect(uow.watchlist.rows).toHaveLength(0);
  });

  it('does not watchlist a refundable booking with no cancellation deadline at all', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    await useCase.execute(
      { ...baseInput({ refundable: true, cancelDeadline: null }), userId: 'user-1' },
      ctx,
    );

    expect(uow.watchlist.rows).toHaveLength(0);
  });
});

/**
 * The other P1 fix this test suite guards: `savings_events` had exactly one
 * producer (`TransitionClaimUseCase`), so a booking on a never-price-matchable
 * channel (FHR chief among them, §2.3.2) left no ledger trace at all.
 *
 * This block also guards the money-math defect fixed in
 * `RecordBookingUseCase.channelChoiceEvent`: the event must be **projected**
 * (a counterfactual, not banked cash), computed **cash-only** (sticker total
 * vs. sticker total — never `effectiveNetCents`, which would double-count
 * the credit and bank soft perks/points valuations as if they were
 * statement money), and must reliably produce a baseline even when the user
 * entered no OTA quote. See `domain/ledger/ChannelChoiceSaving.test.ts` for
 * the pure-function unit tests of the formula and baseline selection this
 * exercises through the full use case.
 */
describe('RecordBookingUseCase — §8.6 projected CHANNEL_CHOICE savings event', () => {
  async function bookWithComparison(
    comparisons: InMemoryComparisonRepository,
    resultSnapshot: readonly ChannelResult[],
    overrides: Partial<CreateBookingInput> = {},
    uow: InMemoryUnitOfWork = new InMemoryUnitOfWork(),
  ) {
    const comparison = await comparisons.create({
      userId: 'user-1',
      propertyNameSnapshot: 'Four Seasons Otemachi',
      checkIn: '2026-08-01',
      checkOut: '2026-08-04',
      nights: 3,
      taxRateBps: 1240,
      contextSnapshot: {} as never,
      resultSnapshot,
      engineVersion: '1.0.0',
      quotes: [],
    });

    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);
    const result = await useCase.execute(
      { ...baseInput({ comparisonId: comparison.id, ...overrides }), userId: 'user-1' },
      ctx,
    );
    return { uow, comparison, result };
  }

  it('writes a projected, cash-only CHANNEL_CHOICE event with a traceable booking_id, using the OTA row as the baseline', async () => {
    const comparisons = new InMemoryComparisonRepository();
    // TC-01's own EDIT and OTA sticker totals (§3.8, shared quote set Q) — a
    // real, spec-verified pair of totals, not invented numbers.
    const resultSnapshot: ChannelResult[] = [
      channelResult({ channel: 'EDIT', totalCents: cents(354_000), effectiveNetCents: cents(239_086) }),
      channelResult({ channel: 'OTA', totalCents: cents(360_000), effectiveNetCents: cents(356_400) }),
    ];

    const { uow, result } = await bookWithComparison(comparisons, resultSnapshot, { channel: 'EDIT' });

    expect(uow.savingsEvents.rows).toHaveLength(1);
    const event = uow.savingsEvents.rows[0];
    expect(event?.kind).toBe('CHANNEL_CHOICE');
    // Projected, not realized — a counterfactual against the comparison
    // snapshot, not money that has actually moved.
    expect(event?.realized).toBe(false);
    expect(event?.bookingId).toBe(result.booking.id);
    // 360000 − 354000 = 6000 — sticker total vs. sticker total, nothing else.
    // Note this is far smaller than the old (buggy) effectiveNet-based
    // formula would have produced, because perks/points/credit are no
    // longer folded in here.
    expect(event?.amountCents).toBe(6_000);
    expect(event?.note).toContain('vs. OTA rate you entered');

    // §8.6: the ledger's own aggregation reports this under projected, never
    // the realized headline.
    const totals = totalsFor(uow.savingsEvents.rows.map(toSavingsEvent));
    expect(totals.realizedCents).toBe(0);
    expect(totals.projectedCents).toBe(6_000);
  });

  it('does not double-count the statement credit: CHANNEL_CHOICE (cash-only) plus CREDIT_BURNED sum to the honest total saved', async () => {
    const uow = new InMemoryUnitOfWork();
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
    const comparisons = new InMemoryComparisonRepository();
    const resultSnapshot: ChannelResult[] = [
      channelResult({ channel: 'EDIT', totalCents: cents(354_000), effectiveNetCents: cents(239_086) }),
      channelResult({ channel: 'OTA', totalCents: cents(360_000), effectiveNetCents: cents(356_400) }),
    ];

    await bookWithComparison(
      comparisons,
      resultSnapshot,
      { channel: 'EDIT', totalCents: 354_000, cashChargedCents: 354_000 },
      uow,
    );

    const channelChoice = uow.savingsEvents.rows.find((row) => row.kind === 'CHANNEL_CHOICE');
    const creditBurned = uow.savingsEvents.rows.find((row) => row.kind === 'CREDIT_BURNED');

    expect(channelChoice?.realized).toBe(false);
    expect(channelChoice?.amountCents).toBe(6_000); // 360000 − 354000, cash-only
    expect(creditBurned?.realized).toBe(true);
    expect(creditBurned?.amountCents).toBe(25_000); // the whole $250 bucket, full price paid

    // The "honest total": had the user instead booked the naive OTA rate —
    // where no statement credit is ever available (§2.2) — they'd have paid
    // 360000 with nothing to burn. Booking EDIT instead cost 354000 net of a
    // 25000 credit, i.e. 329000 actually charged. The true saving is
    // 360000 − 329000 = 31000, which is exactly CHANNEL_CHOICE + CREDIT_BURNED
    // — neither event counts the other's dollars.
    expect((channelChoice?.amountCents ?? 0) + (creditBurned?.amountCents ?? 0)).toBe(31_000);
  });

  it('falls back to the worst-ranked row by sticker total when there is no OTA row, and names the fallback in the note', async () => {
    const comparisons = new InMemoryComparisonRepository();
    // No OTA quote entered — coverage of the ledger must not depend on
    // which rows the user happened to type in.
    const resultSnapshot: ChannelResult[] = [
      channelResult({ channel: 'EDIT', totalCents: cents(354_000) }),
      channelResult({ channel: 'FHR', totalCents: cents(360_000) }),
      channelResult({ channel: 'DIRECT_PREPAID', totalCents: cents(317_000) }),
    ];

    const { uow } = await bookWithComparison(comparisons, resultSnapshot, { channel: 'EDIT' });

    expect(uow.savingsEvents.rows).toHaveLength(1);
    const event = uow.savingsEvents.rows[0];
    expect(event?.kind).toBe('CHANNEL_CHOICE');
    expect(event?.realized).toBe(false);
    // FHR (360000) is the priciest sticker among the entered rows, so it is
    // the fallback baseline: 360000 − 354000 = 6000.
    expect(event?.amountCents).toBe(6_000);
    expect(event?.note).toContain('vs. the most expensive rate you entered');
  });

  it('records no CHANNEL_CHOICE event when the booking has no comparisonId at all', async () => {
    const uow = new InMemoryUnitOfWork();
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    await useCase.execute({ ...baseInput({ comparisonId: null }), userId: 'user-1' }, ctx);

    expect(uow.savingsEvents.rows).toHaveLength(0);
  });

  it('floors at zero: records no CHANNEL_CHOICE event when the booked channel\'s sticker total is no cheaper than the baseline', async () => {
    const comparisons = new InMemoryComparisonRepository();
    // FHR's sticker (400000) is higher than OTA's (360000) — booking it
    // saved nothing in cash terms, so the ledger stays silent rather than
    // recording a floored-to-zero event.
    const resultSnapshot: ChannelResult[] = [
      channelResult({ channel: 'FHR', totalCents: cents(400_000) }),
      channelResult({ channel: 'OTA', totalCents: cents(360_000) }),
    ];

    const { uow } = await bookWithComparison(comparisons, resultSnapshot, {
      channel: 'FHR',
      prepaid: true,
    });

    expect(uow.savingsEvents.rows).toHaveLength(0);
  });
});

/**
 * The P0 fix this task exists for: `credit_buckets.consumed_cents` never
 * moved when a real booking was recorded, so `/credits` always read every
 * bucket as untouched and the comparator could re-claim a credit the user had
 * already spent. See `CompareChannelsUseCase.test.ts` for the second-stay
 * scenario this closes end to end.
 */
describe('RecordBookingUseCase — §2.4 credit-bucket consumption', () => {
  const H2_WINDOW = { start: '2026-07-01', end: '2026-12-31' };
  const H1_WINDOW = { start: '2026-01-01', end: '2026-06-30' };

  function editBucket(overrides: Partial<CreditBucketRecord> = {}): CreditBucketRecord {
    return {
      id: 'edit-bucket-h2',
      userId: 'user-1',
      cardId: 'csr-card',
      key: 'CSR_EDIT_H2',
      label: 'The Edit credit · Jul–Dec',
      faceCents: cents(25_000),
      window: H2_WINDOW,
      consumedCents: cents(0),
      ...overrides,
    };
  }

  it('consumes the matching bucket and assigns it to the booking', async () => {
    const uow = new InMemoryUnitOfWork();
    uow.creditBuckets.rows.push(editBucket());
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    // Full price, well above the $250 face, so the whole credit is kept.
    const result = await useCase.execute(
      { ...baseInput({ channel: 'EDIT', totalCents: 354_000, cashChargedCents: 354_000 }), userId: 'user-1' },
      ctx,
    );

    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucket?.consumedCents).toBe(25_000);
    expect(result.booking.bucketId).toBe('edit-bucket-h2');

    // §2.4's other producer discipline: exactly one CREDIT_BURNED event, for
    // the amount actually applied, traceable to this booking.
    const burned = uow.savingsEvents.rows.find((row) => row.kind === 'CREDIT_BURNED');
    expect(burned?.amountCents).toBe(25_000);
    expect(burned?.bookingId).toBe(result.booking.id);
    expect(burned?.realized).toBe(true);
  });

  it('keeps only a partial amount when the net charge is below face — the §2.4 clawback case', async () => {
    const uow = new InMemoryUnitOfWork();
    uow.creditBuckets.rows.push(editBucket());
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    // TC-05's own net-charge figure: only $177.63 actually hit the card.
    const result = await useCase.execute(
      { ...baseInput({ channel: 'EDIT', totalCents: 40_000, cashChargedCents: 17_763 }), userId: 'user-1' },
      ctx,
    );

    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucket?.consumedCents).toBe(17_763);

    const burned = uow.savingsEvents.rows.find((row) => row.kind === 'CREDIT_BURNED');
    expect(burned?.amountCents).toBe(17_763);
    expect(result.booking.bucketId).toBe('edit-bucket-h2');
  });

  it('is a no-op, not an error, when the booking matches no bucket', async () => {
    const uow = new InMemoryUnitOfWork();
    uow.creditBuckets.rows.push(editBucket()); // only an Edit bucket exists
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    // DIRECT_FLEX unlocks no statement credit at all (§2.2) — no definition
    // in CREDIT_BUCKET_DEFINITIONS lists it, so nothing can match.
    const result = await useCase.execute(
      {
        ...baseInput({ channel: 'DIRECT_FLEX', prepaid: false, totalCents: 300_000, cashChargedCents: 300_000 }),
        userId: 'user-1',
      },
      ctx,
    );

    expect(result.booking.bucketId).toBeNull();
    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucket?.consumedCents).toBe(0);
    expect(uow.savingsEvents.rows.filter((row) => row.kind === 'CREDIT_BURNED')).toHaveLength(0);
    // The booking itself still commits — a missed bucket match is not an error.
    expect(uow.bookings.rows).toHaveLength(1);
  });

  it('is also a no-op when the only matching bucket is already exhausted', async () => {
    const uow = new InMemoryUnitOfWork();
    uow.creditBuckets.rows.push(editBucket({ consumedCents: cents(25_000) })); // fully spent
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute(
      { ...baseInput({ channel: 'EDIT', totalCents: 354_000, cashChargedCents: 354_000 }), userId: 'user-1' },
      ctx,
    );

    // Still assigned — the booking legitimately belongs to that bucket's
    // window — but nothing more can be applied and no phantom saving appears.
    expect(result.booking.bucketId).toBe('edit-bucket-h2');
    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucket?.consumedCents).toBe(25_000);
    expect(uow.savingsEvents.rows.filter((row) => row.kind === 'CREDIT_BURNED')).toHaveLength(0);
  });

  it('resolves the window from the booked-at date, never the stay date — §7.5', async () => {
    const uow = new InMemoryUnitOfWork();
    // Only the H1 bucket is live. The stay itself is in August (H2), but the
    // booking is being recorded — prepaid, today — in January.
    uow.creditBuckets.rows.push(
      editBucket({ id: 'edit-bucket-h1', key: 'CSR_EDIT_H1', window: H1_WINDOW }),
    );
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const januaryCtx: ExecutionContext = { ...ctx, now: new Date('2026-01-15T12:00:00Z') };
    const result = await useCase.execute(
      {
        ...baseInput({
          channel: 'EDIT',
          bookedAt: '2026-01-15T12:00:00.000Z',
          checkIn: '2026-08-01', // the stay is in H2 — irrelevant to window matching
          checkOut: '2026-08-04',
          totalCents: 354_000,
          cashChargedCents: 354_000,
        }),
        userId: 'user-1',
      },
      januaryCtx,
    );

    expect(result.booking.bucketId).toBe('edit-bucket-h1');
    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h1');
    expect(bucket?.consumedCents).toBe(25_000);
  });

  it('does not consume a bucket whose window does not contain the booked-at date, even for the same key family', async () => {
    const uow = new InMemoryUnitOfWork();
    // Only H1 is live; the booking is made in H2, so it must not match H1.
    uow.creditBuckets.rows.push(
      editBucket({ id: 'edit-bucket-h1', key: 'CSR_EDIT_H1', window: H1_WINDOW }),
    );
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute(
      { ...baseInput({ channel: 'EDIT', totalCents: 354_000, cashChargedCents: 354_000 }), userId: 'user-1' },
      ctx, // ctx.now is 2026-07-27 — H2
    );

    expect(result.booking.bucketId).toBeNull();
    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h1');
    expect(bucket?.consumedCents).toBe(0);
  });

  it('does not consume the Edit bucket for an under-two-night stay — the §2.4 minimum applies here too', async () => {
    const uow = new InMemoryUnitOfWork();
    uow.creditBuckets.rows.push(editBucket());
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    const result = await useCase.execute(
      {
        ...baseInput({
          channel: 'EDIT',
          checkIn: '2026-08-01',
          checkOut: '2026-08-02', // one night
          totalCents: 200_000,
          cashChargedCents: 200_000,
        }),
        userId: 'user-1',
      },
      ctx,
    );

    expect(result.booking.bucketId).toBeNull();
    const bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucket?.consumedCents).toBe(0);
  });

  it('the second-stay scenario: a second booking in the same window sees the bucket already exhausted', async () => {
    const uow = new InMemoryUnitOfWork();
    uow.creditBuckets.rows.push(editBucket());
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecordBookingUseCase(deps(), uow, comparisons);

    // Stay #1: burns the whole $250 Edit credit.
    await useCase.execute(
      { ...baseInput({ channel: 'EDIT', totalCents: 354_000, cashChargedCents: 354_000 }), userId: 'user-1' },
      ctx,
    );
    let bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucket?.consumedCents).toBe(25_000);

    // Stay #2, same window: nothing left to give.
    const second = await useCase.execute(
      {
        ...baseInput({
          channel: 'EDIT',
          confirmationNumber: 'CONF-2',
          totalCents: 400_000,
          cashChargedCents: 400_000,
        }),
        userId: 'user-1',
      },
      ctx,
    );

    bucket = uow.creditBuckets.rows.find((row) => row.id === 'edit-bucket-h2');
    expect(bucket?.consumedCents).toBe(25_000); // unchanged — nothing more to consume
    expect(second.booking.bucketId).toBe('edit-bucket-h2'); // still assigned, just $0 left
    expect(uow.savingsEvents.rows.filter((row) => row.kind === 'CREDIT_BURNED')).toHaveLength(1); // only from stay #1
  });
});
