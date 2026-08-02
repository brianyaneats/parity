import { describe, it, expect } from 'vitest';
import { Comparison } from './Comparison';
import { SavingsEngine } from '../engine/SavingsEngine';
import type { Cents } from '../shared/cents';
import type { StayContext } from '../engine/types';

const CENTS = (n: number) => n as Cents;
const engine = new SavingsEngine();

const context: StayContext = {
  nights: 3,
  taxRateBps: 1240,
  breakfastPerDayCents: CENTS(7_000),
  propertyCreditFaceCents: CENTS(10_000),
  realizationPct: 100,
  mrValueMicro: 15_000,
  urValueMicro: 17_500,
  foraRateBps: 700,
  amexBucketAvailable: true,
  editBucketAvailable: true,
  competitorBaseCents: CENTS(300_000),
  competitorRefundable: true,
  competitorPublic: true,
  brand: 'NONE',
};

const outcome = engine.compare({
  context,
  quotes: [
    { channel: 'EDIT', totalCents: CENTS(354_000), prepaid: true, refundable: true },
    { channel: 'FHR', totalCents: CENTS(360_000), prepaid: true, refundable: true },
  ],
});

function saved(id = 'comparison-1') {
  return Comparison.create({
    id,
    userId: 'user-1',
    propertyName: 'Four Seasons Hotel Tokyo at Otemachi',
    checkIn: '2026-09-01',
    checkOut: '2026-09-04',
    nights: 3,
    outcome,
    context,
    now: new Date('2026-07-27T12:00:00Z'),
  });
}

describe('Comparison — snapshot discipline, §4.3', () => {
  it('stores the results as computed at the time', () => {
    const comparison = saved();
    expect(comparison.winner?.channel).toBe('EDIT');
    expect(comparison.winner?.effectiveNetCents).toBe(239_086);
    expect(comparison.engineVersion).toBe('1.0.0');
  });

  it('freezes the snapshot so no caller can rewrite a historical figure', () => {
    const comparison = saved();
    expect(Object.isFrozen(comparison.snapshot)).toBe(true);
    expect(Object.isFrozen(comparison.snapshot.results)).toBe(true);
    expect(Object.isFrozen(comparison.snapshot.context)).toBe(true);
  });

  it('exposes no way to mutate the snapshot', () => {
    // §13.3 predicts this will be gotten wrong. The guarantee is structural:
    // there is no setter and no update method, so a future caller cannot reach
    // for one and quietly rewrite a record the ledger depends on.
    const comparison = saved();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(comparison));
    expect(methods).not.toContain('setSnapshot');
    expect(methods).not.toContain('updateSnapshot');
    expect(methods).not.toContain('refresh');
  });

  it('snapshots the property name rather than joining to it', () => {
    // Renaming a property must not silently rewrite what a six-month-old
    // comparison says it was about.
    expect(saved().propertyNameSnapshot).toBe('Four Seasons Hotel Tokyo at Otemachi');
  });

  it('flags when it was computed under a different engine version', () => {
    const comparison = saved();
    expect(comparison.wasComputedUnder('1.0.0')).toBe(false);
    expect(comparison.wasComputedUnder('1.1.0')).toBe(true);
  });

  it('records that it was saved, with the winner and engine version', () => {
    const [event] = saved().pullDomainEvents();
    expect(event?.type).toBe('comparison.saved');
    expect(event?.payload).toMatchObject({ winner: 'EDIT', engineVersion: '1.0.0' });
  });

  it('rejects a zero-night comparison', () => {
    expect(() =>
      Comparison.create({
        id: 'c',
        userId: 'u',
        propertyName: 'X',
        checkIn: '2026-09-01',
        checkOut: '2026-09-01',
        nights: 0,
        outcome,
        context,
        now: new Date(),
      }),
    ).toThrow(/at least one night/);
  });
});

describe('recompute creates a new record and never mutates the original — §4.3, §5.2', () => {
  it('returns a different aggregate with a new id', () => {
    const original = saved();
    const cheaperContext = { ...context, urValueMicro: 4_000 };
    const cheaperOutcome = engine.compare({
      context: cheaperContext,
      quotes: [
        { channel: 'EDIT', totalCents: CENTS(354_000), prepaid: true, refundable: true },
        { channel: 'FHR', totalCents: CENTS(360_000), prepaid: true, refundable: true },
      ],
    });

    const recomputed = original.recomputeAs({
      id: 'comparison-2',
      outcome: cheaperOutcome,
      context: cheaperContext,
      now: new Date('2026-08-01T00:00:00Z'),
    });

    expect(recomputed.id).toBe('comparison-2');
    expect(recomputed).not.toBe(original);

    // The devalued points flip the winner — proving the recompute really ran.
    expect(recomputed.winner?.channel).toBe('FHR');

    // And the original is untouched.
    expect(original.id).toBe('comparison-1');
    expect(original.winner?.channel).toBe('EDIT');
    expect(original.winner?.effectiveNetCents).toBe(239_086);
  });

  it('links the new record back to the one it came from', () => {
    const original = saved();
    const recomputed = original.recomputeAs({
      id: 'comparison-2',
      outcome,
      context,
      now: new Date(),
    });

    expect(recomputed.recomputedFromId).toBe('comparison-1');
    expect(original.recomputedFromId).toBeNull();
  });

  it('carries the trip, property and dates onto the new record', () => {
    const original = saved();
    const recomputed = original.recomputeAs({
      id: 'comparison-2',
      outcome,
      context,
      now: new Date(),
    });

    expect(recomputed.propertyNameSnapshot).toBe(original.propertyNameSnapshot);
    expect(recomputed.checkIn).toBe(original.checkIn);
    expect(recomputed.nights).toBe(original.nights);
    expect(recomputed.userId).toBe(original.userId);
  });

  it('starts the new record as a fresh draft', () => {
    const original = saved();
    original.decide('EDIT', new Date());

    const recomputed = original.recomputeAs({
      id: 'comparison-2',
      outcome,
      context,
      now: new Date(),
    });

    expect(recomputed.status).toBe('DRAFT');
    expect(recomputed.chosenChannel).toBeNull();
    expect(original.status).toBe('DECIDED');
  });
});

describe('Comparison rehydration and serialisation', () => {
  it('rehydrates a stored row without re-running the engine', () => {
    // §4.3: reading a saved comparison must never recompute it. Rehydration is
    // the only way a persisted row becomes an aggregate, and it takes the
    // snapshot as given.
    const rehydrated = Comparison.rehydrate({
      id: 'comparison-9',
      userId: 'user-1',
      tripId: 'trip-1',
      propertyId: 'property-1',
      propertyNameSnapshot: 'Aman Tokyo',
      checkIn: '2026-09-01',
      checkOut: '2026-09-04',
      nights: 3,
      snapshot: {
        context,
        results: outcome.results,
        engineVersion: '0.9.0',
      },
      status: 'BOOKED',
      chosenChannel: 'FHR',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      recomputedFromId: 'comparison-8',
    });

    expect(rehydrated.status).toBe('BOOKED');
    expect(rehydrated.chosenChannel).toBe('FHR');
    expect(rehydrated.engineVersion).toBe('0.9.0');
    expect(rehydrated.recomputedFromId).toBe('comparison-8');
    expect(rehydrated.tripId).toBe('trip-1');
    // Raised no event: rehydration is a read, not a domain happening.
    expect(rehydrated.pendingEvents).toEqual([]);
  });

  it('flags a rehydrated row computed under an older engine', () => {
    const stale = Comparison.rehydrate({
      id: 'c',
      userId: 'u',
      tripId: null,
      propertyId: null,
      propertyNameSnapshot: 'X',
      checkIn: '2026-09-01',
      checkOut: '2026-09-02',
      nights: 1,
      snapshot: { context, results: outcome.results, engineVersion: '0.9.0' },
      status: 'DRAFT',
      chosenChannel: null,
      createdAt: new Date(),
    });
    expect(stale.wasComputedUnder('1.0.0')).toBe(true);
  });

  it('reports no winner for a comparison whose snapshot holds no results', () => {
    const empty = Comparison.rehydrate({
      id: 'c',
      userId: 'u',
      tripId: null,
      propertyId: null,
      propertyNameSnapshot: 'X',
      checkIn: '2026-09-01',
      checkOut: '2026-09-02',
      nights: 1,
      snapshot: { context, results: [], engineVersion: '1.0.0' },
      status: 'DRAFT',
      chosenChannel: null,
      createdAt: new Date(),
    });
    expect(empty.winner).toBeNull();
    expect(empty.followedRecommendation()).toBeNull();
  });

  it('serialises every field the list and detail views read', () => {
    const comparison = saved();
    comparison.decide('EDIT', new Date('2026-07-27T13:00:00Z'));

    expect(comparison.toJSON()).toEqual({
      id: 'comparison-1',
      userId: 'user-1',
      tripId: null,
      propertyId: null,
      propertyNameSnapshot: 'Four Seasons Hotel Tokyo at Otemachi',
      checkIn: '2026-09-01',
      checkOut: '2026-09-04',
      nights: 3,
      status: 'DECIDED',
      chosenChannel: 'EDIT',
      engineVersion: '1.0.0',
      recomputedFromId: null,
      createdAt: '2026-07-27T12:00:00.000Z',
    });
  });
});

describe('Comparison status and the §1.5 success measurement', () => {
  it('records the channel actually chosen', () => {
    const comparison = saved();
    comparison.decide('FHR', new Date());
    expect(comparison.status).toBe('DECIDED');
    expect(comparison.chosenChannel).toBe('FHR');
  });

  it('refuses a channel that was never part of the comparison', () => {
    expect(() => saved().decide('OTA', new Date())).toThrow(/not part of this comparison/);
  });

  it('reports whether the user followed the recommendation', () => {
    // §1.5: "The user's ranked #1 channel is the one they actually book, at
    // least 80% of the time." This is the per-comparison measurement.
    const followed = saved();
    followed.decide('EDIT', new Date());
    expect(followed.followedRecommendation()).toBe(true);

    const ignored = saved('comparison-3');
    ignored.decide('FHR', new Date());
    expect(ignored.followedRecommendation()).toBe(false);

    expect(saved('comparison-4').followedRecommendation()).toBeNull();
  });

  it('walks draft → decided → booked', () => {
    const comparison = saved();
    comparison.decide('EDIT', new Date());
    comparison.transitionTo('BOOKED', new Date());
    expect(comparison.status).toBe('BOOKED');
  });

  it('treats a booked comparison as final', () => {
    const comparison = saved();
    comparison.decide('EDIT', new Date());
    comparison.transitionTo('BOOKED', new Date());
    expect(() => comparison.transitionTo('ABANDONED', new Date())).toThrow(/cannot move/);
  });

  it('lets an abandoned comparison be reopened as a draft', () => {
    const comparison = saved();
    comparison.transitionTo('ABANDONED', new Date());
    comparison.transitionTo('DRAFT', new Date());
    expect(comparison.status).toBe('DRAFT');
  });

  it('treats a no-op transition as a no-op rather than an error', () => {
    const comparison = saved();
    comparison.pullDomainEvents();
    comparison.transitionTo('DRAFT', new Date());
    expect(comparison.pendingEvents).toEqual([]);
  });
});
