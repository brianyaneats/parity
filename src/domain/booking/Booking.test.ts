import { describe, it, expect } from 'vitest';
import { Booking } from './Booking';
import { Claim } from '../claim/Claim';
import type { Cents } from '../shared/cents';
import type { Channel } from '../rules/channels.rules';

const CENTS = (n: number) => n as Cents;

function record(over: Partial<Parameters<typeof Booking.record>[0]> = {}): Booking {
  return Booking.record({
    id: 'booking-1',
    userId: 'user-1',
    comparisonId: 'comparison-1',
    channel: 'EDIT',
    confirmationNumber: null,
    bookedAt: new Date('2026-07-27T12:00:00Z'),
    checkIn: '2026-09-01',
    checkOut: '2026-09-04',
    totalCents: CENTS(354_000),
    baseCents: CENTS(314_947),
    cashChargedCents: null,
    pointsUsed: null,
    prepaid: true,
    refundable: true,
    cancelDeadline: '2026-08-28',
    bucketId: null,
    ...over,
  });
}

describe('Booking.record — §5.2 auto-claim side effect', () => {
  it('raises booking.recorded flagging that a claim should open', () => {
    const booking = record();
    const [event] = booking.pullDomainEvents();

    expect(event?.type).toBe('booking.recorded');
    expect(event?.payload).toMatchObject({ opensClaim: true, claimKind: 'CHASE_PM' });
  });

  it('opens a claim for both price-matchable channels when prepaid', () => {
    for (const channel of ['EDIT', 'CHASE_TRAVEL'] as Channel[]) {
      expect(record({ channel }).opensPriceMatchClaim).toBe(true);
    }
  });

  it('opens no claim on a channel Chase cannot reach', () => {
    // Fixture TC-06's rule, at the booking layer: applying price-match logic to
    // an Amex channel is the single most likely implementation bug.
    for (const channel of ['FHR', 'THC', 'OTA', 'DIRECT_FLEX', 'FORA', 'PHONE'] as Channel[]) {
      const booking = record({ channel });
      expect(booking.opensPriceMatchClaim).toBe(false);
      expect(booking.pullDomainEvents()[0]?.payload).toMatchObject({
        opensClaim: false,
        claimKind: null,
      });
    }
  });

  it('opens no claim on a pay-at-property Edit booking — PM3 requires prepaid', () => {
    expect(record({ prepaid: false }).opensPriceMatchClaim).toBe(false);
  });

  it('produces a claim whose deadline is exactly 24 hours after booking', () => {
    const booking = record();
    const claim = Claim.openForBooking({
      id: 'claim-1',
      userId: booking.userId,
      bookingId: booking.id,
      kind: 'CHASE_PM',
      bookedAt: booking.bookedAt,
    });

    expect(claim.deadlineAt.toISOString()).toBe('2026-07-28T12:00:00.000Z');
    expect(claim.status).toBe('ELIGIBLE');
  });

  it('rejects a stay that ends before it starts', () => {
    expect(() => record({ checkIn: '2026-09-04', checkOut: '2026-09-01' })).toThrow(
      /after check-in/,
    );
  });

  it('rejects a zero-night stay', () => {
    expect(() => record({ checkIn: '2026-09-01', checkOut: '2026-09-01' })).toThrow(
      /after check-in/,
    );
  });

  it('rejects a negative total', () => {
    expect(() => record({ totalCents: CENTS(-1) })).toThrow(/cannot be negative/);
  });
});

describe('Booking — the charge a statement credit keys off', () => {
  it('falls back to the total when no payment split was recorded', () => {
    // Conservative: assuming more points were used than actually were would
    // overstate the clawback risk and nag about a problem that does not exist.
    expect(record().effectiveCashChargedCents()).toBe(354_000);
  });

  it('uses the recorded cash portion once known', () => {
    const booking = record();
    booking.recordPaymentSplit(CENTS(50_000), 20_000, new Date());
    expect(booking.effectiveCashChargedCents()).toBe(50_000);
    expect(booking.pointsUsed).toBe(20_000);
  });

  it('rejects a negative payment split', () => {
    expect(() => record().recordPaymentSplit(CENTS(-1), 0, new Date())).toThrow(
      /cannot be negative/,
    );
  });

  it('nets a refund off the charge and floors at zero', () => {
    const booking = record();
    booking.recordPaymentSplit(CENTS(40_000), 0, new Date());
    expect(booking.netChargeAfterRefund(CENTS(22_237))).toBe(17_763);
    expect(booking.netChargeAfterRefund(CENTS(99_999))).toBe(0);
  });
});

describe('Booking — the watchlist predicate, §7.6', () => {
  it('is re-shoppable while refundable with a future cancellation deadline', () => {
    expect(record().isReshoppable('2026-08-01')).toBe(true);
  });

  it('is not re-shoppable once the cancellation deadline has passed', () => {
    expect(record().isReshoppable('2026-08-29')).toBe(false);
  });

  it('is never re-shoppable when non-refundable', () => {
    expect(record({ refundable: false }).isReshoppable('2026-08-01')).toBe(false);
  });

  it('is never re-shoppable with no cancellation deadline recorded', () => {
    expect(record({ cancelDeadline: null }).isReshoppable('2026-08-01')).toBe(false);
  });

  it('is not re-shoppable once cancelled', () => {
    const booking = record();
    booking.transitionTo('CANCELLED', new Date());
    expect(booking.isReshoppable('2026-08-01')).toBe(false);
  });
});

describe('Booking lifecycle', () => {
  it('cancels and reports the bucket it was holding, so the credit is released', () => {
    const booking = record();
    booking.assignBucket('bucket-1', new Date());
    booking.pullDomainEvents();

    booking.transitionTo('CANCELLED', new Date());
    const [event] = booking.pullDomainEvents();

    expect(event?.type).toBe('booking.cancelled');
    expect(event?.payload).toMatchObject({ releasesBucket: 'bucket-1' });
  });

  it('completes without releasing anything', () => {
    const booking = record();
    booking.transitionTo('COMPLETED', new Date());
    expect(booking.status).toBe('COMPLETED');
  });

  it('refuses to move out of a terminal status', () => {
    const booking = record();
    booking.transitionTo('COMPLETED', new Date());
    expect(() => booking.transitionTo('CANCELLED', new Date())).toThrow(/cannot move/);
  });

  it('records a confirmation number', () => {
    const booking = record();
    booking.recordConfirmation('ABC123', new Date());
    expect(booking.confirmationNumber).toBe('ABC123');
  });

  it('round-trips through JSON', () => {
    expect(record().toJSON()).toMatchObject({
      channel: 'EDIT',
      status: 'ACTIVE',
      totalCents: 354_000,
      bookedAt: '2026-07-27T12:00:00.000Z',
    });
  });
});
