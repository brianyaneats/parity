import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SavingsEngine } from './SavingsEngine';
import { evaluateChannel } from './channel-evaluator';
import { CHANNEL_RANK_ORDER } from '../rules/channels.rules';
import type { Cents } from '../shared/cents';
import type { ChannelQuote, StayContext } from './types';

/**
 * §3.9 — property-based tests.
 *
 * Fixtures prove the engine right on nine known inputs. These prove it
 * self-consistent across the whole input space, which is where a rounding bug
 * that no fixture happens to touch would otherwise survive.
 */

const engine = new SavingsEngine({ includeSensitivity: false });

/**
 * Point valuations are bounded to 0–5¢ and the Fora rebate to 0–100%.
 *
 * This is not generator laziness. The monotonicity property in §3.9 is only
 * true while a dollar of spend cannot earn more than a dollar of value back: at
 * 8× Ultimate Rewards, a valuation above 12.5¢/point would make an *increase*
 * in sticker price genuinely reduce the effective net, and the property would
 * be false rather than the code being wrong. 5¢ is already double any defensible
 * valuation and leaves a wide margin.
 */
const contextArbitrary = fc.record({
  nights: fc.integer({ min: 1, max: 30 }),
  taxRateBps: fc.integer({ min: 0, max: 5_000 }),
  breakfastPerDayCents: fc.integer({ min: 0, max: 50_000 }),
  propertyCreditFaceCents: fc.integer({ min: 0, max: 100_000 }),
  realizationPct: fc.integer({ min: 0, max: 100 }),
  mrValueMicro: fc.integer({ min: 0, max: 50_000 }),
  urValueMicro: fc.integer({ min: 0, max: 50_000 }),
  foraRateBps: fc.integer({ min: 0, max: 10_000 }),
  amexBucketAvailable: fc.boolean(),
  editBucketAvailable: fc.boolean(),
  competitorBaseCents: fc.option(fc.integer({ min: 0, max: 2_000_000 }), { nil: null }),
  competitorRefundable: fc.boolean(),
  competitorPublic: fc.boolean(),
  brand: fc.constantFrom('NONE' as const, 'HYATT' as const, 'HILTON' as const),
}) as fc.Arbitrary<StayContext>;

const quoteArbitrary = fc.record({
  channel: fc.constantFrom(...CHANNEL_RANK_ORDER),
  totalCents: fc.integer({ min: 0, max: 2_000_000 }),
  prepaid: fc.boolean(),
  refundable: fc.boolean(),
}) as fc.Arbitrary<ChannelQuote>;

const RUNS = { numRuns: 1_000 } as const;

describe('§3.9 property — tax identity', () => {
  it('base + tax === total, exactly, for all inputs', () => {
    fc.assert(
      fc.property(contextArbitrary, quoteArbitrary, (ctx, quote) => {
        const result = evaluateChannel(quote, ctx);
        expect(result.baseCents + result.taxCents).toBe(result.totalCents);
      }),
      RUNS,
    );
  });
});

describe('§3.9 property — credit bounds', () => {
  it('creditKept never exceeds creditFace', () => {
    fc.assert(
      fc.property(contextArbitrary, quoteArbitrary, (ctx, quote) => {
        const result = evaluateChannel(quote, ctx);
        expect(result.creditKeptCents).toBeLessThanOrEqual(result.creditFaceCents);
      }),
      RUNS,
    );
  });

  it('creditKept + clawback === creditFace', () => {
    fc.assert(
      fc.property(contextArbitrary, quoteArbitrary, (ctx, quote) => {
        const result = evaluateChannel(quote, ctx);
        expect(result.creditKeptCents + result.clawbackCents).toBe(result.creditFaceCents);
      }),
      RUNS,
    );
  });

  it('clawback is never negative', () => {
    fc.assert(
      fc.property(contextArbitrary, quoteArbitrary, (ctx, quote) => {
        expect(evaluateChannel(quote, ctx).clawbackCents).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });
});

describe('§3.9 property — refund bound', () => {
  it('refund ≤ max(0, gap), always', () => {
    fc.assert(
      fc.property(contextArbitrary, quoteArbitrary, (ctx, quote) => {
        const result = evaluateChannel(quote, ctx);
        expect(result.refundCents).toBeLessThanOrEqual(Math.max(0, result.priceMatch.gapCents));
      }),
      RUNS,
    );
  });

  it('never produces a negative refund, even when the own rate is already cheapest', () => {
    fc.assert(
      fc.property(contextArbitrary, quoteArbitrary, (ctx, quote) => {
        expect(evaluateChannel(quote, ctx).refundCents).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });
});

/**
 * §3.9 states monotonicity unconditionally: "increasing any channel's
 * `totalCents` never decreases its `effectiveNetCents`."
 *
 * **That is false for the spec's own algorithm in exactly one regime**, and the
 * regime is reachable rather than theoretical. See DECISIONS.md D-004.
 *
 * Differentiating step 14 with respect to `total` gives the marginal effect of
 * one more cent of sticker price:
 *
 * | regime | d(net)/d(total) |
 * |---|---|
 * | Amex prepaid, credit fully kept | +0.75 |
 * | Amex prepaid, **credit capped by the charge** | **−0.25** |
 * | Edit qualifying, credit capped by the charge | 0.00 |
 * | Edit qualifying, credit fully kept | +0.09 |
 * | Fora, 7% rebate | +0.93 |
 *
 * The negative row is the clawback regime: once `netCharge < face`, every extra
 * cent charged is fully absorbed by the statement credit *and* additionally
 * earns points on the full total, so the marginal value returned exceeds the
 * marginal cost. Spending more genuinely leaves you better off.
 *
 * That is not a bug to be papered over — it is the exact phenomenon
 * `minCashFloor` exists to exploit (§2.4, §8.3: "charge at least $472.37 to the
 * card and cover the rest with points"). Changing the algorithm to satisfy the
 * property would break the clawback rule and fixture TC-05 with it, and §0.2
 * makes fixtures the higher authority.
 *
 * So the property is asserted over its true domain, and the exception is
 * asserted separately as documented, intended behaviour.
 */
describe('§3.9 property — monotonicity', () => {
  it('increasing a total never decreases its effective net, outside the clawback regime', () => {
    fc.assert(
      fc.property(
        contextArbitrary,
        quoteArbitrary,
        fc.integer({ min: 1, max: 200_000 }),
        (ctx, quote, increase) => {
          const before = evaluateChannel(quote, ctx);
          const after = evaluateChannel(
            { ...quote, totalCents: (quote.totalCents + increase) as Cents },
            ctx,
          );

          // The engine flags this regime with CLAWBACK_RISK and quantifies the
          // way out with minCashFloor. It is excluded here, not ignored — the
          // test below pins its behaviour.
          fc.pre(before.clawbackCents === 0 && after.clawbackCents === 0);

          expect(after.effectiveNetCents).toBeGreaterThanOrEqual(before.effectiveNetCents);
        },
      ),
      RUNS,
    );
  });

  it('inside the clawback regime, charging more improves the net — which is what minCashFloor tells you to do', () => {
    const ctx: StayContext = {
      nights: 2,
      taxRateBps: 0,
      breakfastPerDayCents: 0 as Cents,
      propertyCreditFaceCents: 0 as Cents,
      realizationPct: 0,
      mrValueMicro: 15_000,
      urValueMicro: 17_500,
      foraRateBps: 700,
      amexBucketAvailable: true,
      editBucketAvailable: true,
      competitorBaseCents: null,
      competitorRefundable: true,
      competitorPublic: true,
      brand: 'NONE',
    };

    // A $200 FHR stay against a $300 credit: the credit is capped by the charge
    // and $100 of it is clawed back.
    const under = evaluateChannel(
      { channel: 'FHR', totalCents: 20_000 as Cents, prepaid: true, refundable: true },
      ctx,
    );
    expect(under.clawbackCents).toBe(10_000);
    expect(under.warnings).toContain('CLAWBACK_RISK');

    // Charging the full face value keeps the whole credit and claws back nothing.
    const atFloor = evaluateChannel(
      { channel: 'FHR', totalCents: 30_000 as Cents, prepaid: true, refundable: true },
      ctx,
    );
    expect(atFloor.clawbackCents).toBe(0);
    expect(atFloor.warnings).not.toContain('CLAWBACK_RISK');

    // The counterintuitive part, stated as an assertion: the more expensive
    // booking nets *better*, because the extra spend was going to be refunded
    // by the credit anyway and it earns points on the way through.
    expect(atFloor.effectiveNetCents).toBeLessThan(under.effectiveNetCents);

    // And this is precisely the number the app puts on screen before booking.
    expect(atFloor.priceMatch.minCashFloorCents).toBe(30_000);
  });
});

describe('§3.9 property — determinism', () => {
  it('identical input produces byte-identical output, 1,000 runs', () => {
    fc.assert(
      fc.property(contextArbitrary, fc.array(quoteArbitrary, { minLength: 1, maxLength: 8 }), (ctx, quotes) => {
        const first = engine.compare({ context: ctx, quotes });
        const second = engine.compare({ context: ctx, quotes });
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
      RUNS,
    );
  });
});

describe('§3.9 property — ranking stability', () => {
  it('shuffling the input quotes never changes the winner', () => {
    fc.assert(
      fc.property(
        contextArbitrary,
        fc.array(quoteArbitrary, { minLength: 2, maxLength: 8 }),
        fc.integer({ min: 0, max: 10_000 }),
        (ctx, quotes, seed) => {
          const baseline = engine.compare({ context: ctx, quotes });

          // A deterministic permutation derived from `seed`, so a failure is
          // reproducible from the counterexample fast-check prints.
          const shuffled = [...quotes]
            .map((quote, index) => ({ quote, key: (index * 2_654_435_761 + seed) % 1_000_003 }))
            .sort((a, b) => a.key - b.key)
            .map((entry) => entry.quote);

          const permuted = engine.compare({ context: ctx, quotes: shuffled });

          expect(permuted.winner?.channel).toBe(baseline.winner?.channel);
          expect(permuted.winner?.effectiveNetCents).toBe(baseline.winner?.effectiveNetCents);
        },
      ),
      RUNS,
    );
  });

  it('ranks ascending by effective net with no inversions', () => {
    fc.assert(
      fc.property(contextArbitrary, fc.array(quoteArbitrary, { minLength: 1, maxLength: 8 }), (ctx, quotes) => {
        const { ranked } = engine.compare({ context: ctx, quotes });
        for (let i = 1; i < ranked.length; i += 1) {
          const previous = ranked[i - 1];
          const current = ranked[i];
          if (!previous || !current) continue;
          expect(current.result.effectiveNetCents).toBeGreaterThanOrEqual(
            previous.result.effectiveNetCents,
          );
        }
      }),
      RUNS,
    );
  });
});

describe('§3.6 edge cases — each has a defined answer', () => {
  const base: StayContext = {
    nights: 3,
    taxRateBps: 1240,
    breakfastPerDayCents: 7_000 as Cents,
    propertyCreditFaceCents: 10_000 as Cents,
    realizationPct: 100,
    mrValueMicro: 15_000,
    urValueMicro: 17_500,
    foraRateBps: 700,
    amexBucketAvailable: true,
    editBucketAvailable: true,
    competitorBaseCents: 300_000 as Cents,
    competitorRefundable: true,
    competitorPublic: true,
    brand: 'NONE',
  };
  const editQuote: ChannelQuote = {
    channel: 'EDIT',
    totalCents: 354_000 as Cents,
    prepaid: true,
    refundable: true,
  };

  it('rejects nights = 0 rather than dividing by zero', () => {
    expect(() => evaluateChannel(editQuote, { ...base, nights: 0 })).toThrow(/at least one night/);
  });

  it('rejects negative nights', () => {
    expect(() => evaluateChannel(editQuote, { ...base, nights: -2 })).toThrow(/at least one night/);
  });

  it('rejects a fractional night count', () => {
    expect(() => evaluateChannel(editQuote, { ...base, nights: 2.5 })).toThrow(
      /at least one night/,
    );
  });

  it('treats a null competitor as "nothing to compare", not an error', () => {
    const result = evaluateChannel(editQuote, { ...base, competitorBaseCents: null });
    expect(result.priceMatch.gapCents).toBe(0);
    expect(result.priceMatch.qualifies).toBe(false);
    expect(result.refundCents).toBe(0);
  });

  it('shows no refund when the competitor rate is higher than our own', () => {
    const result = evaluateChannel(editQuote, { ...base, competitorBaseCents: 900_000 as Cents });
    expect(result.priceMatch.gapCents).toBeLessThan(0);
    expect(result.priceMatch.qualifies).toBe(false);
    expect(result.refundCents).toBe(0);
  });

  it('does not qualify at a gap of exactly $5.00 per night — PM7 is strictly greater', () => {
    // 3 nights × 500 = 1500 cents of gap, i.e. exactly the floor.
    const ctx: StayContext = { ...base, taxRateBps: 0, competitorBaseCents: 352_500 as Cents };
    const result = evaluateChannel(editQuote, ctx);
    expect(result.priceMatch.perNightCents).toBe(500);
    expect(result.priceMatch.qualifies).toBe(false);
    expect(result.priceMatch.failedConditions).toContain('PM7');
  });

  it('qualifies one cent per night above the floor', () => {
    const ctx: StayContext = { ...base, taxRateBps: 0, competitorBaseCents: 352_497 as Cents };
    const result = evaluateChannel(editQuote, ctx);
    expect(result.priceMatch.perNightCents).toBe(501);
    expect(result.priceMatch.qualifies).toBe(true);
  });

  it('returns zero points value when a valuation is set to zero', () => {
    const result = evaluateChannel(editQuote, { ...base, urValueMicro: 0 });
    expect(result.pointsValueCents).toBe(0);
    expect(result.pointsEarned).toBeGreaterThan(0);
  });

  it('treats a zero tax rate as base === total', () => {
    const result = evaluateChannel(editQuote, { ...base, taxRateBps: 0 });
    expect(result.baseCents).toBe(result.totalCents);
    expect(result.taxCents).toBe(0);
  });

  it('allows the same channel twice and labels by index without deduping', () => {
    const outcome = engine.compare({
      context: base,
      quotes: [editQuote, { ...editQuote, totalCents: 360_000 as Cents }],
    });
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0]?.label).toMatch(/\(1\)$/);
    expect(outcome.results[1]?.label).toMatch(/\(2\)$/);
  });

  it('does not suffix a label when the channel appears only once', () => {
    const outcome = engine.compare({ context: base, quotes: [editQuote] });
    expect(outcome.results[0]?.label).not.toMatch(/\(\d\)$/);
  });

  it('computes points on the full net charge when the Edit bucket is already used', () => {
    const withBucket = evaluateChannel(editQuote, base);
    const withoutBucket = evaluateChannel(editQuote, { ...base, editBucketAvailable: false });

    expect(withoutBucket.creditFaceCents).toBe(0);
    expect(withoutBucket.clawbackCents).toBe(0);
    expect(withoutBucket.pointsValueCents).toBeGreaterThan(withBucket.pointsValueCents);
  });

  it('returns a genuinely negative effective net rather than clamping it', () => {
    // Fixture TC-05's shape: a cheap stay whose perks, credit and refund exceed it.
    const result = evaluateChannel(
      { channel: 'EDIT', totalCents: 40_000 as Cents, prepaid: true, refundable: true },
      { ...base, nights: 2, competitorBaseCents: 13_350 as Cents },
    );
    expect(result.effectiveNetCents).toBe(-24_000);
    expect(result.warnings).toContain('OVER_SUBSIDIZED');
    expect(result.warnings).toContain('CLAWBACK_RISK');
  });
});
