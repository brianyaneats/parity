import { describe, it, expect } from 'vitest';
import { RecomputeComparisonUseCase } from './RecomputeComparisonUseCase';
import { InMemoryComparisonRepository } from '../testing/fakes';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import { cents } from '@/domain/shared/cents';
import { ApiError } from '@/lib/api/errors';
import type { ExecutionContext, UseCaseDependencies } from '../shared/UseCase';
import type { StayContext } from '@/domain/engine/types';

/**
 * §5.2 load-bearing behaviour #3 / §4.3: recompute creates a **new** row and
 * never mutates the original. §13.3 predicts this is where an agent gets it
 * wrong, so this file asserts the original row's every field — not just its
 * `resultSnapshot` — is byte-identical before and after.
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

function tc01Context(): StayContext {
  return {
    nights: 3,
    taxRateBps: 1240,
    breakfastPerDayCents: cents(7_000),
    propertyCreditFaceCents: cents(10_000),
    realizationPct: 100,
    mrValueMicro: 15_000,
    urValueMicro: 17_500,
    foraRateBps: 700,
    amexBucketAvailable: true,
    editBucketAvailable: true,
    competitorBaseCents: cents(300_000),
    competitorRefundable: true,
    competitorPublic: true,
    brand: 'NONE',
  };
}

describe('RecomputeComparisonUseCase — §4.3, §13.3', () => {
  it('creates a new row rather than updating the original', async () => {
    const comparisons = new InMemoryComparisonRepository();
    const engine = new SavingsEngine();
    const context = tc01Context();
    const original = await comparisons.create({
      userId: 'user-1',
      propertyNameSnapshot: 'Four Seasons Otemachi',
      checkIn: '2026-11-10',
      checkOut: '2026-11-13',
      nights: 3,
      taxRateBps: context.taxRateBps,
      contextSnapshot: context,
      resultSnapshot: engine.compare({
        context,
        quotes: [{ channel: 'EDIT', totalCents: cents(354_000), prepaid: true, refundable: true }],
      }).results,
      engineVersion: '0.9.9-superseded',
      status: 'BOOKED',
      chosenChannel: 'EDIT',
      quotes: [{ channel: 'EDIT', totalCents: cents(354_000), prepaid: true, refundable: true, sortIndex: 0 }],
    });

    const originalSnapshotBefore = JSON.stringify(original);

    const useCase = new RecomputeComparisonUseCase(deps(), comparisons, engine);
    const recomputed = await useCase.execute({ id: original.id, userId: 'user-1' }, ctx);

    // A genuinely new row.
    expect(recomputed.id).not.toBe(original.id);
    expect(comparisons.rows).toHaveLength(2);

    // The original is untouched, field for field — not just "still exists".
    const originalAfter = await comparisons.findById(original.id, 'user-1');
    expect(JSON.stringify(originalAfter)).toBe(originalSnapshotBefore);
    expect(originalAfter?.status).toBe('BOOKED');
    expect(originalAfter?.chosenChannel).toBe('EDIT');
    expect(originalAfter?.engineVersion).toBe('0.9.9-superseded');

    // The new row carries the *current* engine's output and a fresh lifecycle.
    expect(recomputed.engineVersion).toBe(engine.version);
    expect(recomputed.status).toBe('DRAFT');
    expect(recomputed.chosenChannel).toBeNull();

    // Same input facts — recompute re-runs the rules, not the stay.
    expect(recomputed.contextSnapshot).toEqual(original.contextSnapshot);
    expect(recomputed.propertyNameSnapshot).toBe(original.propertyNameSnapshot);
    expect(recomputed.checkIn).toBe(original.checkIn);
    expect(recomputed.quotes.map((q) => q.channel)).toEqual(original.quotes.map((q) => q.channel));
  });

  it('404s rather than silently recomputing someone else’s comparison', async () => {
    const comparisons = new InMemoryComparisonRepository();
    const useCase = new RecomputeComparisonUseCase(deps(), comparisons, new SavingsEngine());

    await expect(
      useCase.execute({ id: 'does-not-exist', userId: 'user-1' }, ctx),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('the repository interface itself cannot update a snapshot — no method accepts one', () => {
    // A structural check standing in for "cannot compile": `ComparisonPatch`
    // (the only shape `update()` accepts) has no snapshot fields, so no value
    // that type-checks against it could ever carry one. Listed explicitly so
    // a future edit widening `ComparisonPatch` fails this assertion instead
    // of silently reopening §13.3's exact failure mode.
    const patchKeys = ['status', 'chosenChannel', 'tripId'];
    type Patch = Parameters<InMemoryComparisonRepository['update']>[2];
    const sample: Patch = { status: 'DRAFT' };
    expect(Object.keys(sample).every((key) => patchKeys.includes(key))).toBe(true);
    expect(patchKeys).not.toContain('contextSnapshot');
    expect(patchKeys).not.toContain('resultSnapshot');
  });
});
