import { describe, it, expect } from 'vitest';
import { UseCase, CommandUseCase, type ExecutionContext, type UseCaseDependencies } from './shared/UseCase';
import { CompareChannelsUseCase } from './usecases/CompareChannelsUseCase';
import { toStayContext, toChannelQuotes, deriveTaxRateBps } from './mappers/compare-mapper';
import { compareRequestSchema } from '@/lib/validation/compare';
import { MemoryLogger } from '@/infrastructure/observability/Logger';
import { MetricsRegistry } from '@/infrastructure/observability/MetricsRegistry';
import { FixedClock } from '@/domain/shared/Clock';
import { domainEvent } from '@/domain/shared/DomainEvent';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import type { Cents } from '@/domain/shared/cents';
import type {
  CreditBucketRecord,
  CreditBucketRepository,
} from './ports/CreditBucketRepository';

const engineForTests = new SavingsEngine();

/**
 * The owner asked for logging and performance metrics on *each task*. These
 * tests exist because "we added instrumentation" is a claim, and the only way
 * it stays true through later refactors is if a test fails when it stops being
 * true. See DECISIONS.md D-040.
 */

function deps(): UseCaseDependencies & { logger: MemoryLogger; metrics: MetricsRegistry } {
  const logger = new MemoryLogger();
  const metrics = new MetricsRegistry({ now: () => 0 });
  return { logger, metrics, clock: new FixedClock('2026-07-27T12:00:00Z') };
}


/**
 * A credit-bucket repository seeded with both semiannual buckets live.
 *
 * `CompareChannelsUseCase` now reads bucket state server-side and overrides
 * whatever the client claimed (§5.3: the server's answer is authoritative) —
 * the fix for a defect where every comparison after the first in a half-year
 * window silently re-claimed a credit that was already spent.
 *
 * These fixtures assert TC-01's published figures, which assume both credits
 * live, so the fake has to actually say so. That is the point: it is no longer
 * possible to assert those numbers without the buckets to back them, which is
 * exactly the guarantee the fix adds.
 */
function bucketRepositoryFake(
  options: { amexConsumed?: number; editConsumed?: number } = {},
): CreditBucketRepository {
  const window = { start: '2026-07-01', end: '2026-12-31' };
  const record = (
    key: string,
    faceCents: number,
    consumedCents: number,
  ): CreditBucketRecord => ({
    id: `bucket-${key}`,
    userId: 'user-1',
    cardId: null,
    key,
    label: key,
    faceCents: faceCents as Cents,
    window,
    consumedCents: consumedCents as Cents,
  });

  const rows: CreditBucketRecord[] = [
    record('AMEX_HOTEL_H2', 30_000, options.amexConsumed ?? 0),
    record('CSR_EDIT_H2', 25_000, options.editConsumed ?? 0),
  ];

  return {
    upsert: async () => {
      throw new Error('not used in these tests');
    },
    listByUser: async () => rows,
    findById: async () => null,
    setConsumedCents: async () => null,
    listForExpirySweep: async () => [],
  };
}

const ctx: ExecutionContext = {
  userId: 'user-1',
  requestId: 'req-1',
  now: new Date('2026-07-27T12:00:00Z'),
};

class EchoUseCase extends UseCase<{ value: number }, number> {
  public readonly name = 'echo';
  protected async handle(input: { value: number }): Promise<number> {
    return input.value * 2;
  }
  protected override describeInput(input: { value: number }) {
    return { value: input.value };
  }
}

class ExplodingUseCase extends UseCase<void, never> {
  public readonly name = 'exploding';
  protected async handle(): Promise<never> {
    throw new Error('deliberate failure');
  }
}

class SlowUseCase extends UseCase<void, string> {
  public readonly name = 'slow';
  protected override readonly budgetMs = -1; // Anything at all exceeds it.
  protected async handle(): Promise<string> {
    return 'done';
  }
}

class EventingUseCase extends CommandUseCase<void, void> {
  public readonly name = 'eventing';
  public dispatched: string[] = [];
  protected async handle(_input: void, context: ExecutionContext): Promise<void> {
    await this.publish(
      [domainEvent('booking.recorded', 'booking-1', context.now, { channel: 'EDIT' })],
      context,
      { dispatch: async (events) => { this.dispatched = events.map((e) => e.type); } },
      this.deps.logger,
    );
  }
}

describe('UseCase — instrumentation is structural, not conventional', () => {
  it('returns the handler result unchanged', async () => {
    await expect(new EchoUseCase(deps()).execute({ value: 21 }, ctx)).resolves.toBe(42);
  });

  it('logs a start line and a success line, both correlated by request id', async () => {
    const d = deps();
    await new EchoUseCase(d).execute({ value: 1 }, ctx);

    expect(d.logger.messages()).toEqual(['use case started', 'use case succeeded']);
    for (const record of d.logger.records) {
      expect(record.fields).toMatchObject({
        useCase: 'echo',
        requestId: 'req-1',
        userId: 'user-1',
      });
    }
  });

  it('records an invocation counter, a latency sample and a success outcome', async () => {
    const d = deps();
    await new EchoUseCase(d).execute({ value: 1 }, ctx);

    const snapshot = d.metrics.snapshot();
    expect(snapshot.counters['usecase.invocations{usecase="echo"}']).toBe(1);
    expect(snapshot.counters['usecase.outcome{outcome="success",usecase="echo"}']).toBe(1);
    expect(snapshot.histograms['usecase.duration_ms{usecase="echo"}']?.count).toBe(1);
  });

  it('surfaces whatever the input description opts into, and nothing else', async () => {
    const d = deps();
    await new EchoUseCase(d).execute({ value: 7 }, ctx);
    expect(d.logger.records[0]?.fields).toMatchObject({ value: 7 });
  });

  it('records a failure outcome and rethrows, still measuring the duration', async () => {
    const d = deps();
    await expect(new ExplodingUseCase(d).execute(undefined, ctx)).rejects.toThrow(
      'deliberate failure',
    );

    const snapshot = d.metrics.snapshot();
    expect(snapshot.counters['usecase.outcome{outcome="failure",usecase="exploding"}']).toBe(1);
    // A use case that is slow because it is failing is exactly the sample you want.
    expect(snapshot.histograms['usecase.duration_ms{usecase="exploding"}']?.count).toBe(1);

    const errorRecord = d.logger.records.find((r) => r.level === 'error');
    expect(errorRecord?.message).toBe('use case failed');
    expect((errorRecord?.fields.error as { message: string }).message).toBe('deliberate failure');
  });

  it('warns rather than fails when a latency budget is exceeded', async () => {
    const d = deps();
    await expect(new SlowUseCase(d).execute(undefined, ctx)).resolves.toBe('done');

    const warning = d.logger.records.find((r) => r.level === 'warn');
    expect(warning?.message).toBe('use case exceeded its latency budget');
    expect(warning?.fields).toHaveProperty('durationMs');
    expect(warning?.fields).toHaveProperty('budgetMs');
    expect(d.metrics.snapshot().counters['usecase.budget_exceeded{usecase="slow"}']).toBe(1);
  });

  it('dispatches domain events and counts them', async () => {
    const d = deps();
    const useCase = new EventingUseCase(d);
    await useCase.execute(undefined, ctx);

    expect(useCase.dispatched).toEqual(['booking.recorded']);
    expect(d.metrics.snapshot().counters['domain.events_published{usecase="eventing"}']).toBe(1);
  });
});

describe('CompareChannelsUseCase — §5.2, §5.3', () => {
  const request = compareRequestSchema.parse({
    context: {
      nights: 3,
      taxRateBps: 1240,
      breakfastPerDayCents: 7000,
      propertyCreditFaceCents: 10000,
      realizationPct: 100,
      mrValueMicro: 15000,
      urValueMicro: 17500,
      foraRateBps: 700,
      amexBucketAvailable: true,
      editBucketAvailable: true,
      competitorBaseCents: 300000,
      competitorRefundable: true,
      competitorPublic: true,
      brand: 'NONE',
    },
    quotes: [
      { channel: 'EDIT', totalCents: 354000, prepaid: true, refundable: true },
      { channel: 'FHR', totalCents: 360000, prepaid: true, refundable: true },
    ],
  });

  it('produces the same numbers as the engine — the math is never forked', async () => {
    const outcome = await new CompareChannelsUseCase(deps(), engineForTests, bucketRepositoryFake()).execute(request, ctx);

    // TC-01's published values, reached through the API layer rather than the
    // engine directly. §5.3: "Do not fork the math into two implementations."
    expect(outcome.winner?.channel).toBe('EDIT');
    expect(outcome.winner?.effectiveNetCents).toBe(239_086);
    expect(outcome.results.find((r) => r.channel === 'FHR')?.effectiveNetCents).toBe(272_000);
  });


  /**
   * The second-stay defect, pinned.
   *
   * Two product managers independently found that `amexBucketAvailable` /
   * `editBucketAvailable` were `useState(true)` on the client and forwarded
   * straight to the engine. So the user's *second* stay in a half-year window
   * confidently re-claimed a credit already spent on the first — which can flip
   * the ranked winner, breaking §1.5's first success criterion.
   *
   * The request below still says `editBucketAvailable: true`, exactly as a
   * stale client would. The server must disagree with it.
   */
  it('ignores the client’s claim and reads the real bucket state — §5.3', async () => {
    const spent = new CompareChannelsUseCase(
      deps(),
      engineForTests,
      bucketRepositoryFake({ editConsumed: 25_000 }),
    );

    const outcome = await spent.execute(request, ctx);
    const edit = outcome.results.find((r) => r.channel === 'EDIT');

    expect(outcome.bucketAvailability.editBucketAvailable).toBe(false);
    expect(outcome.bucketAvailability.editRemainingCents).toBe(0);
    // No phantom $250: the face is zero and TC-02's figure is the honest one.
    expect(edit?.creditFaceCents).toBe(0);
    expect(edit?.effectiveNetCents).toBe(260_586);
  });

  it('reports the remaining balance so the UI can show it rather than guess', async () => {
    const partly = new CompareChannelsUseCase(
      deps(),
      engineForTests,
      bucketRepositoryFake({ editConsumed: 10_000 }),
    );

    const outcome = await partly.execute(request, ctx);
    expect(outcome.bucketAvailability.editRemainingCents).toBe(15_000);
    expect(outcome.bucketAvailability.amexRemainingCents).toBe(30_000);
  });

  it('carries the §5.3 latency budget of 100 ms', () => {
    const useCase = new CompareChannelsUseCase(deps(), engineForTests, bucketRepositoryFake());
    expect(Reflect.get(useCase, 'budgetMs')).toBe(100);
  });

  it('records business counters, not just latency', async () => {
    const d = deps();
    await new CompareChannelsUseCase(d, engineForTests, bucketRepositoryFake()).execute(request, ctx);

    const { counters } = d.metrics.snapshot();
    expect(counters['compare.winner{channel="EDIT"}']).toBe(1);
    expect(counters['compare.price_match_available']).toBe(1);
    expect(counters['compare.warning{warning="POINTS_DOMINATES"}']).toBe(1);
  });

  it('counts a clawback risk when one is present', async () => {
    const d = deps();
    const clawbackRequest = compareRequestSchema.parse({
      ...request,
      context: { ...request.context, nights: 2, competitorBaseCents: 13350 },
      quotes: [{ channel: 'EDIT', totalCents: 40000, prepaid: true, refundable: true }],
    });

    await new CompareChannelsUseCase(d, engineForTests, bucketRepositoryFake()).execute(clawbackRequest, ctx);
    expect(d.metrics.snapshot().counters['compare.clawback_risk']).toBe(1);
  });

  it('logs the shape of a request but never the rates — §12', async () => {
    const d = deps();
    await new CompareChannelsUseCase(d, engineForTests, bucketRepositoryFake()).execute(request, ctx);

    const start = d.logger.records[0];
    expect(start?.fields).toMatchObject({ quoteCount: 2, nights: 3, hasCompetitor: true });

    const serialised = JSON.stringify(d.logger.records);
    expect(serialised).not.toContain('354000');
    expect(serialised).not.toContain('300000');
  });
});

describe('compare-mapper — the branding boundary', () => {
  it('preserves a null competitor rather than turning it into a free room', () => {
    const context = toStayContext({ ...requestContext(), competitorBaseCents: null });
    expect(context.competitorBaseCents).toBeNull();
  });

  it('carries every context field through unchanged', () => {
    const context = toStayContext(requestContext());
    expect(context).toMatchObject({
      nights: 3,
      taxRateBps: 1240,
      breakfastPerDayCents: 7000,
      competitorBaseCents: 300000,
      brand: 'NONE',
    });
  });

  it('omits an absent label instead of setting it to undefined', () => {
    const [withoutLabel, withLabel] = toChannelQuotes([
      { channel: 'EDIT', totalCents: 1, prepaid: true, refundable: true },
      { channel: 'EDIT', totalCents: 2, prepaid: true, refundable: true, label: 'Suite' },
    ]);
    expect('label' in (withoutLabel ?? {})).toBe(false);
    expect(withLabel?.label).toBe('Suite');
  });

  function requestContext() {
    return {
      nights: 3,
      taxRateBps: 1240,
      breakfastPerDayCents: 7000,
      propertyCreditFaceCents: 10000,
      realizationPct: 100,
      mrValueMicro: 15000,
      urValueMicro: 17500,
      foraRateBps: 700,
      amexBucketAvailable: true,
      editBucketAvailable: true,
      competitorBaseCents: 300000 as number | null,
      competitorRefundable: true,
      competitorPublic: true,
      brand: 'NONE' as const,
    };
  }
});

/**
 * §7.3 item 3: "the user often knows base and total but not the rate." This is
 * the inline calculator that derives it.
 */
describe('deriveTaxRateBps — the §7.3 helper', () => {
  it('derives from base and total', () => {
    expect(deriveTaxRateBps({ baseCents: 314947, totalCents: 354000 })).toBe(1240);
  });

  it('derives from base and tax', () => {
    expect(deriveTaxRateBps({ baseCents: 314947, taxCents: 39053 })).toBe(1240);
  });

  it('derives from tax and total', () => {
    expect(deriveTaxRateBps({ taxCents: 39053, totalCents: 354000 })).toBe(1240);
  });

  it('returns null rather than a fabricated 0% when the base is zero', () => {
    expect(deriveTaxRateBps({ baseCents: 0, totalCents: 100 })).toBeNull();
  });

  it('returns null when only one figure is known', () => {
    expect(deriveTaxRateBps({ totalCents: 354000 })).toBeNull();
    expect(deriveTaxRateBps({})).toBeNull();
  });

  it('reports a zero rate when there genuinely is no tax', () => {
    expect(deriveTaxRateBps({ baseCents: 1000, taxCents: 0 })).toBe(0);
  });
});

describe('compareRequestSchema — the validation boundary', () => {
  const valid = {
    context: {
      nights: 3,
      taxRateBps: 1240,
      breakfastPerDayCents: 7000,
      propertyCreditFaceCents: 10000,
      realizationPct: 100,
      mrValueMicro: 15000,
      urValueMicro: 17500,
      foraRateBps: 700,
      amexBucketAvailable: true,
      editBucketAvailable: true,
      competitorBaseCents: 300000,
      competitorRefundable: true,
      competitorPublic: true,
      brand: 'NONE',
    },
    quotes: [{ channel: 'EDIT', totalCents: 354000, prepaid: true, refundable: true }],
  };

  it('accepts a well-formed payload', () => {
    expect(compareRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects nights below one, with a message the UI can show inline', () => {
    const result = compareRequestSchema.safeParse({
      ...valid,
      context: { ...valid.context, nights: 0 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/at least 1/);
  });

  it('rejects a fractional cent — money is integers only', () => {
    const result = compareRequestSchema.safeParse({
      ...valid,
      quotes: [{ ...valid.quotes[0], totalCents: 354000.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a realization percentage above 100', () => {
    expect(
      compareRequestSchema.safeParse({
        ...valid,
        context: { ...valid.context, realizationPct: 120 },
      }).success,
    ).toBe(false);
  });

  it('accepts a null competing rate — §3.6 says it is not an error', () => {
    expect(
      compareRequestSchema.safeParse({
        ...valid,
        context: { ...valid.context, competitorBaseCents: null },
      }).success,
    ).toBe(true);
  });

  it('accepts a zero tax rate and zero point valuations', () => {
    expect(
      compareRequestSchema.safeParse({
        ...valid,
        context: { ...valid.context, taxRateBps: 0, urValueMicro: 0, mrValueMicro: 0 },
      }).success,
    ).toBe(true);
  });

  it('allows the same channel twice — §3.6 forbids silent deduping', () => {
    expect(
      compareRequestSchema.safeParse({
        ...valid,
        quotes: [valid.quotes[0], valid.quotes[0]],
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown channel', () => {
    expect(
      compareRequestSchema.safeParse({
        ...valid,
        quotes: [{ ...valid.quotes[0], channel: 'MYSTERY_PORTAL' }],
      }).success,
    ).toBe(false);
  });

  it('accepts an empty quote list so the screen can render its partial state', () => {
    expect(compareRequestSchema.safeParse({ ...valid, quotes: [] }).success).toBe(true);
  });
});
