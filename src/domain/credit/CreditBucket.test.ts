import { describe, it, expect } from 'vitest';
import { CreditBucket, totalUnburnedCents, nearestExpiry } from './CreditBucket';
import {
  windowFor,
  windowForDefinition,
  windowContains,
  daysRemainingIn,
  toIsoDate,
} from './CreditWindow';
import { CREDIT_BUCKET_DEFINITIONS } from '../rules/credit.rules';
import { evaluateChannel } from '../engine/channel-evaluator';
import type { Cents } from '../shared/cents';
import type { StayContext } from '../engine/types';

const CENTS = (n: number) => n as Cents;

function bucket(over: Partial<Parameters<typeof CreditBucket.create>[0]> = {}): CreditBucket {
  return CreditBucket.create({
    id: 'bucket-1',
    userId: 'user-1',
    cardId: 'card-1',
    key: 'CSR_EDIT_H2',
    label: 'The Edit credit · Jul–Dec',
    faceCents: CENTS(25_000),
    window: { start: '2026-07-01', end: '2026-12-31' },
    consumedCents: CENTS(0),
    ...over,
  });
}

describe('CreditWindow — §2.4', () => {
  it('computes the two calendar half-year windows', () => {
    expect(windowFor('CALENDAR_H1', { year: 2026 })).toEqual({
      start: '2026-01-01',
      end: '2026-06-30',
    });
    expect(windowFor('CALENDAR_H2', { year: 2026 })).toEqual({
      start: '2026-07-01',
      end: '2026-12-31',
    });
  });

  it('honours a fixed end date for the select-brands credit', () => {
    expect(windowFor('FIXED', { year: 2026 }, '2026-12-31')).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });

  it('falls back to the calendar year for a fixed window with no end date', () => {
    expect(windowFor('FIXED', { year: 2026 }).end).toBe('2026-12-31');
  });

  it('runs a cardmember year from the anniversary to the day before it recurs', () => {
    expect(windowFor('CARDMEMBER_YEAR', { year: 2026, anniversary: '2024-03-15' })).toEqual({
      start: '2026-03-15',
      end: '2027-03-14',
    });
  });

  it('handles a 1 January anniversary without rolling into the wrong year', () => {
    expect(windowFor('CARDMEMBER_YEAR', { year: 2026, anniversary: '2020-01-01' })).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });

  it('falls back to the calendar year rather than guessing an unset anniversary', () => {
    // DECISIONS.md D-063: a guessed anniversary produces a confidently wrong
    // expiry countdown, which is worse than an acknowledged assumption.
    expect(windowFor('CARDMEMBER_YEAR', { year: 2026, anniversary: null })).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });

  it('builds a window for every seeded definition', () => {
    for (const definition of CREDIT_BUCKET_DEFINITIONS) {
      const window = windowForDefinition(definition, { year: 2026, anniversary: '2024-03-15' });
      expect(window.start <= window.end).toBe(true);
    }
  });

  it('treats both ends of a window as inclusive', () => {
    const window = { start: '2026-07-01', end: '2026-12-31' };
    expect(windowContains(window, '2026-07-01')).toBe(true);
    expect(windowContains(window, '2026-12-31')).toBe(true);
    expect(windowContains(window, '2026-06-30')).toBe(false);
    expect(windowContains(window, '2027-01-01')).toBe(false);
  });

  it('counts days to expiry from UTC midnights so every timezone agrees', () => {
    expect(daysRemainingIn({ start: '2026-07-01', end: '2026-12-31' }, '2026-12-28')).toBe(3);
    expect(daysRemainingIn({ start: '2026-07-01', end: '2026-12-31' }, '2026-12-31')).toBe(0);
    expect(daysRemainingIn({ start: '2026-07-01', end: '2026-12-31' }, '2027-01-02')).toBe(-2);
  });

  it('formats an instant as a date in a named zone', () => {
    // 23:00 in New York on the 27th is already the 28th in UTC. A bucket that
    // expires "today" must not expire a day early for a user in one zone.
    const instant = new Date('2026-07-28T03:00:00Z');
    expect(toIsoDate(instant, 'UTC')).toBe('2026-07-28');
    expect(toIsoDate(instant, 'America/New_York')).toBe('2026-07-27');
  });
});

describe('CreditBucket invariants', () => {
  it('rejects a negative face value', () => {
    expect(() => bucket({ faceCents: CENTS(-1) })).toThrow(/negative face value/);
  });

  it('rejects negative consumption', () => {
    expect(() => bucket({ consumedCents: CENTS(-1) })).toThrow(/negative amount/);
  });

  it('rejects a window that ends before it starts', () => {
    expect(() => bucket({ window: { start: '2026-12-31', end: '2026-07-01' } })).toThrow(
      /end before it starts/,
    );
  });
});

describe('CreditBucket — remaining, status and windows', () => {
  it('reports what is left after partial consumption', () => {
    const b = bucket({ consumedCents: CENTS(10_000) });
    expect(b.remainingCents).toBe(15_000);
    expect(b.isExhausted).toBe(false);
  });

  it('never reports a negative remaining balance', () => {
    expect(bucket({ consumedCents: CENTS(99_999) }).remainingCents).toBe(0);
  });

  /**
   * §7.5, and the single most valuable non-obvious fact on the screen: a
   * booking prepaid now for a stay next year still burns *this* window's credit.
   * The window test is against the booking date, never the stay date.
   */
  it('accepts a booking by its booking date, not the stay date', () => {
    const b = bucket();
    expect(b.acceptsBookingOn('2026-12-20')).toBe(true);
    expect(b.acceptsBookingOn('2027-01-05')).toBe(false);
  });

  it('refuses a booking once exhausted, even inside the window', () => {
    expect(bucket({ consumedCents: CENTS(25_000) }).acceptsBookingOn('2026-08-01')).toBe(false);
  });

  it('bands the status by days remaining — §7.5', () => {
    const b = bucket();
    expect(b.status('2026-08-01')).toBe('NEUTRAL');   // 152 days
    expect(b.status('2026-11-15')).toBe('WARNING');   // 46 days
    expect(b.status('2026-12-15')).toBe('CRITICAL');  // 16 days
    expect(b.status('2027-01-01')).toBe('EXPIRED');
  });

  it('places the band boundaries exactly where §7.5 puts them', () => {
    const b = bucket();
    // Neutral above 60 days, warning from 30 through 60, critical below 30.
    expect(b.status('2026-10-31')).toBe('NEUTRAL');   // 61 days
    expect(b.status('2026-11-01')).toBe('WARNING');   // 60 days
    expect(b.status('2026-12-01')).toBe('WARNING');   // 30 days
    expect(b.status('2026-12-02')).toBe('CRITICAL');  // 29 days
  });
});

/**
 * The clawback rule (§2.4) is computed in two places — the engine, for a
 * hypothetical booking, and this aggregate, for a real one. They must agree,
 * and TC-05 is the fixture that proves it.
 */
describe('the clawback rule agrees with the engine on fixture TC-05', () => {
  const ctx: StayContext = {
    nights: 2,
    taxRateBps: 1240,
    breakfastPerDayCents: CENTS(7_000),
    propertyCreditFaceCents: CENTS(10_000),
    realizationPct: 100,
    mrValueMicro: 15_000,
    urValueMicro: 17_500,
    foraRateBps: 700,
    amexBucketAvailable: true,
    editBucketAvailable: true,
    competitorBaseCents: CENTS(13_350),
    competitorRefundable: true,
    competitorPublic: true,
    brand: 'NONE',
  };

  const engineResult = evaluateChannel(
    { channel: 'EDIT', totalCents: CENTS(40_000), prepaid: true, refundable: true },
    ctx,
  );

  it('keeps and claws back the same amounts as the engine', () => {
    const netCharge = CENTS(engineResult.totalCents - engineResult.refundCents);
    const assessment = bucket().assess(netCharge);

    expect(netCharge).toBe(17_763);
    expect(assessment.keptCents).toBe(engineResult.creditKeptCents);
    expect(assessment.keptCents).toBe(17_763);
    expect(assessment.clawbackCents).toBe(engineResult.clawbackCents);
    expect(assessment.clawbackCents).toBe(7_237);
  });

  it('computes the same $472.37 cash floor the engine reports', () => {
    expect(bucket().minCashFloorCents(engineResult.refundCents)).toBe(
      engineResult.priceMatch.minCashFloorCents,
    );
    expect(bucket().minCashFloorCents(engineResult.refundCents)).toBe(47_237);
  });

  it('claws back nothing once the charge clears the face value', () => {
    const assessment = bucket().assess(CENTS(30_000));
    expect(assessment.keptCents).toBe(25_000);
    expect(assessment.clawbackCents).toBe(0);
  });

  it('keeps nothing from a fully refunded charge', () => {
    const assessment = bucket().assess(CENTS(0));
    expect(assessment.keptCents).toBe(0);
    expect(assessment.clawbackCents).toBe(25_000);
  });

  it('treats a negative net charge as zero rather than as a credit', () => {
    expect(bucket().assess(CENTS(-500)).keptCents).toBe(0);
  });

  it('assesses against what remains, not the original face', () => {
    const partlyUsed = bucket({ consumedCents: CENTS(20_000) });
    const assessment = partlyUsed.assess(CENTS(30_000));
    expect(assessment.keptCents).toBe(5_000);
    expect(assessment.clawbackCents).toBe(0);
  });
});

describe('CreditBucket consumption', () => {
  const now = new Date('2026-08-01T00:00:00Z');

  it('records consumption and emits an event', () => {
    const b = bucket();
    expect(b.consume(CENTS(10_000), now, 'booking-1')).toBe(10_000);
    expect(b.consumedCents).toBe(10_000);
    expect(b.remainingCents).toBe(15_000);

    const [event] = b.pullDomainEvents();
    expect(event?.type).toBe('credit.consumed');
    expect(event?.payload).toMatchObject({ appliedCents: 10_000, remainingCents: 15_000 });
  });

  it('caps consumption at the remaining balance — the issuer caps it too', () => {
    const b = bucket();
    expect(b.consume(CENTS(99_999), now)).toBe(25_000);
    expect(b.remainingCents).toBe(0);
  });

  it('rejects a negative consumption', () => {
    expect(() => bucket().consume(CENTS(-1), now)).toThrow(/negative amount/);
  });

  it('releases what a cancelled booking was holding', () => {
    const b = bucket({ consumedCents: CENTS(20_000) });
    expect(b.release(CENTS(5_000), now)).toBe(5_000);
    expect(b.remainingCents).toBe(10_000);
    expect(b.pullDomainEvents()[0]?.type).toBe('credit.released');
  });

  it('cannot release more than was consumed', () => {
    const b = bucket({ consumedCents: CENTS(5_000) });
    expect(b.release(CENTS(99_999), now)).toBe(5_000);
    expect(b.consumedCents).toBe(0);
  });

  it('rejects a negative release', () => {
    expect(() => bucket().release(CENTS(-1), now)).toThrow(/negative amount/);
  });
});

/**
 * §7.5's headline: "total unburned credit and the nearest expiry — the number
 * that costs real money if ignored."
 */
describe('the /credits headline figures — §7.5', () => {
  const live = [
    bucket({ id: 'a', key: 'CSR_EDIT_H2', faceCents: CENTS(25_000), consumedCents: CENTS(5_000) }),
    bucket({
      id: 'b',
      key: 'AMEX_HOTEL_H2',
      faceCents: CENTS(30_000),
      consumedCents: CENTS(0),
      window: { start: '2026-07-01', end: '2026-12-31' },
    }),
    bucket({
      id: 'c',
      key: 'CSR_EDIT_H1',
      faceCents: CENTS(25_000),
      consumedCents: CENTS(0),
      window: { start: '2026-01-01', end: '2026-06-30' },
    }),
  ];

  it('sums only what is still claimable', () => {
    // The H1 bucket closed in June, so its unspent $250 is gone, not pending.
    expect(totalUnburnedCents(live, '2026-08-01')).toBe(50_000);
  });

  it('counts everything while all windows are still open', () => {
    expect(totalUnburnedCents(live, '2026-06-01')).toBe(75_000);
  });

  it('names the bucket that expires soonest', () => {
    expect(nearestExpiry(live, '2026-06-01')?.id).toBe('c');
    expect(nearestExpiry(live, '2026-08-01')?.id).toBe('a');
  });

  it('reports no nearest expiry when everything is spent', () => {
    const spent = [bucket({ consumedCents: CENTS(25_000) })];
    expect(nearestExpiry(spent, '2026-08-01')).toBeNull();
    expect(totalUnburnedCents(spent, '2026-08-01')).toBe(0);
  });

  it('serialises the fields the wallet screen renders', () => {
    expect(bucket({ consumedCents: CENTS(5_000) }).toJSON()).toMatchObject({
      key: 'CSR_EDIT_H2',
      faceCents: 25_000,
      consumedCents: 5_000,
      remainingCents: 20_000,
    });
  });
});
