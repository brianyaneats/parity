import { describe, it, expect, vi } from 'vitest';
import { creditFaceFor, missesNightMinimum } from './credit-face';
import { pointsFor, forfeitsPrepaidMultiplier } from './points';
import { perksFor } from './perks';
import { assessPriceMatch } from './price-match';
import { rankResults, winnerOf, compareResults } from './ranking';
import { evaluateBrg } from './brg';
import { analyseSensitivity } from './sensitivity';
import { SavingsEngine } from './SavingsEngine';
import { evaluateChannel, buildQuoteLabels } from './channel-evaluator';
import { RecordingProfiler, NULL_PROFILER } from './profiler';
import { WARNING_COPY } from './warnings';
import { CHANNEL_RANK_ORDER } from '../rules/channels.rules';
import type { Cents } from '../shared/cents';
import type { Channel, ChannelQuote, ChannelResult, StayContext } from './types';

/**
 * Branch-level unit tests. §10.1 requires **100% of branches** on the engine:
 * "it is 400 lines and it is the product."
 *
 * The fixtures prove the happy paths. These reach the branches no realistic
 * comparison happens to take — the defensive guards, the tie-breaks, the chain
 * programmes with unusual minimum-gap notations.
 */

const CENTS = (n: number) => n as Cents;

const baseContext: StayContext = {
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

const quote = (
  channel: Channel,
  totalCents: number,
  prepaid = true,
  refundable = true,
): ChannelQuote => ({ channel, totalCents: CENTS(totalCents), prepaid, refundable });

// ---------------------------------------------------------------- credit face

describe('creditFaceFor — §3.3 step 8', () => {
  const call = (over: Partial<Parameters<typeof creditFaceFor>[0]> = {}) =>
    creditFaceFor({
      channel: 'FHR',
      prepaid: true,
      nights: 3,
      amexBucketAvailable: true,
      editBucketAvailable: true,
      ...over,
    });

  it('grants FHR the full Amex face with no night minimum', () => {
    expect(call({ channel: 'FHR', nights: 1 })).toBe(30_000);
  });

  it('grants nothing when the booking is not prepaid', () => {
    expect(call({ channel: 'FHR', prepaid: false })).toBe(0);
  });

  it('grants nothing for FHR when the Amex bucket is spent', () => {
    expect(call({ channel: 'FHR', amexBucketAvailable: false })).toBe(0);
  });

  it('grants THC the Amex face only at two nights or more', () => {
    expect(call({ channel: 'THC', nights: 2 })).toBe(30_000);
    expect(call({ channel: 'THC', nights: 1 })).toBe(0);
    expect(call({ channel: 'THC', nights: 2, amexBucketAvailable: false })).toBe(0);
  });

  it('grants EDIT the Chase face only at two nights or more', () => {
    expect(call({ channel: 'EDIT', nights: 2 })).toBe(25_000);
    expect(call({ channel: 'EDIT', nights: 1 })).toBe(0);
    expect(call({ channel: 'EDIT', nights: 3, editBucketAvailable: false })).toBe(0);
  });

  it.each<Channel>(['CHASE_TRAVEL', 'DIRECT_FLEX', 'DIRECT_PREPAID', 'OTA', 'FORA', 'PHONE'])(
    'grants no portal credit for %s',
    (channel) => {
      expect(call({ channel })).toBe(0);
    },
  );

  it('fails loudly on an unknown channel rather than silently forfeiting a credit', () => {
    expect(() => call({ channel: 'MADE_UP' as Channel })).toThrow(/No statement-credit rule/);
  });

  it('reports which channels miss the night minimum', () => {
    expect(missesNightMinimum('EDIT', 1)).toBe(true);
    expect(missesNightMinimum('THC', 1)).toBe(true);
    expect(missesNightMinimum('EDIT', 2)).toBe(false);
    expect(missesNightMinimum('FHR', 1)).toBe(false);
  });
});

// -------------------------------------------------------------------- points

describe('pointsFor — §2.5', () => {
  const call = (over: Partial<Parameters<typeof pointsFor>[0]> = {}) =>
    pointsFor({
      channel: 'FHR',
      prepaid: true,
      totalCents: CENTS(360_000),
      netChargeCents: CENTS(360_000),
      creditKeptCents: CENTS(30_000),
      mrValueMicro: 15_000,
      urValueMicro: 17_500,
      ...over,
    });

  it('earns 5× Membership Rewards on the full total when prepaid', () => {
    const outcome = call();
    expect(outcome.multiplier).toBe(5);
    expect(outcome.earningBaseCents).toBe(360_000);
    expect(outcome.valueCents).toBe(27_000);
    expect(outcome.points).toBe(18_000);
  });

  it('drops to 1× when paying at the property — the expensive mistake', () => {
    const outcome = call({ prepaid: false });
    expect(outcome.multiplier).toBe(1);
    expect(outcome.valueCents).toBe(5_400);
  });

  it('earns 8× Ultimate Rewards on the portion no credit covered', () => {
    const outcome = call({
      channel: 'EDIT',
      totalCents: CENTS(354_000),
      netChargeCents: CENTS(339_053),
      creditKeptCents: CENTS(25_000),
    });
    expect(outcome.earningBaseCents).toBe(314_053);
    expect(outcome.valueCents).toBe(43_967);
  });

  it('never earns on a negative uncovered portion', () => {
    const outcome = call({
      channel: 'EDIT',
      netChargeCents: CENTS(1_000),
      creditKeptCents: CENTS(25_000),
    });
    expect(outcome.earningBaseCents).toBe(0);
    expect(outcome.valueCents).toBe(0);
  });

  it('models OTA loyalty as a flat 1% cash equivalent, not a points currency', () => {
    const outcome = call({ channel: 'OTA' });
    expect(outcome.valueCents).toBe(3_600);
    expect(outcome.points).toBe(0);
    expect(outcome.multiplier).toBe(0);
  });

  it.each<Channel>(['DIRECT_FLEX', 'DIRECT_PREPAID', 'FORA', 'PHONE'])(
    'earns nothing in the engine for %s',
    (channel) => {
      const outcome = call({ channel });
      expect(outcome.valueCents).toBe(0);
      expect(outcome.earningBaseCents).toBe(0);
    },
  );

  it('flags only the Amex channels as forfeiting a prepaid multiplier', () => {
    expect(forfeitsPrepaidMultiplier('FHR', false)).toBe(true);
    expect(forfeitsPrepaidMultiplier('THC', false)).toBe(true);
    expect(forfeitsPrepaidMultiplier('FHR', true)).toBe(false);
    expect(forfeitsPrepaidMultiplier('EDIT', false)).toBe(false);
    expect(forfeitsPrepaidMultiplier('OTA', false)).toBe(false);
  });
});

// --------------------------------------------------------------------- perks

describe('perksFor — §2.6', () => {
  it('values breakfast per night plus the realised property credit', () => {
    const outcome = perksFor({
      channel: 'EDIT',
      nights: 3,
      breakfastPerDayCents: CENTS(7_000),
      propertyCreditFaceCents: CENTS(10_000),
      realizationPct: 100,
    });
    expect(outcome.breakfastCents).toBe(21_000);
    expect(outcome.propertyCreditCents).toBe(10_000);
    expect(outcome.totalCents).toBe(31_000);
  });

  it('discounts a credit the user will not fully spend', () => {
    const outcome = perksFor({
      channel: 'FHR',
      nights: 2,
      breakfastPerDayCents: CENTS(7_000),
      propertyCreditFaceCents: CENTS(10_000),
      realizationPct: 20,
    });
    expect(outcome.propertyCreditCents).toBe(2_000);
    expect(outcome.totalCents).toBe(16_000);
  });

  it('grants nothing on channels without portal perks, including Chase Travel', () => {
    for (const channel of ['CHASE_TRAVEL', 'OTA', 'FORA', 'DIRECT_FLEX'] as Channel[]) {
      const outcome = perksFor({
        channel,
        nights: 3,
        breakfastPerDayCents: CENTS(7_000),
        propertyCreditFaceCents: CENTS(10_000),
        realizationPct: 100,
      });
      expect(outcome.totalCents).toBe(0);
    }
  });
});

// --------------------------------------------------------------- price match

describe('assessPriceMatch — §2.3.1', () => {
  const call = (over: Partial<Parameters<typeof assessPriceMatch>[0]> = {}) =>
    assessPriceMatch({
      channel: 'EDIT',
      prepaid: true,
      refundable: true,
      baseCents: CENTS(314_947),
      nights: 3,
      competitorBaseCents: CENTS(300_000),
      competitorRefundable: true,
      competitorPublic: true,
      creditFaceCents: CENTS(25_000),
      ...over,
    });

  it('qualifies on the golden path with no failed conditions', () => {
    const assessment = call();
    expect(assessment.qualifies).toBe(true);
    expect(assessment.failedConditions).toEqual([]);
    expect(assessment.estimatedRefundCents).toBe(14_947);
    expect(assessment.minCashFloorCents).toBe(39_947);
  });

  it('fails PM2 for a channel Chase cannot reach', () => {
    expect(call({ channel: 'FHR' }).failedConditions).toContain('PM2');
  });

  it('fails PM3 when the booking is not prepaid', () => {
    expect(call({ prepaid: false }).failedConditions).toContain('PM3');
  });

  it('fails PM7 when the nightly gap does not clear the floor', () => {
    expect(call({ competitorBaseCents: CENTS(313_500) }).failedConditions).toContain('PM7');
  });

  it('fails PM8 when the competing rate is non-refundable', () => {
    expect(call({ competitorRefundable: false }).failedConditions).toContain('PM8');
  });

  it('fails PM8 when our own booking is non-refundable', () => {
    expect(call({ refundable: false }).failedConditions).toContain('PM8');
  });

  it('fails PM9 when the competing rate is not publicly available', () => {
    expect(call({ competitorPublic: false }).failedConditions).toContain('PM9');
  });

  it('reports a zero per-night gap when nights is zero rather than dividing by it', () => {
    const assessment = call({ nights: 0 });
    expect(assessment.perNightCents).toBe(0);
    expect(assessment.qualifies).toBe(false);
  });

  it('never qualifies without a competing rate, even with no failed conditions', () => {
    const assessment = call({ competitorBaseCents: null, nights: 3 });
    expect(assessment.gapCents).toBe(0);
    expect(assessment.qualifies).toBe(false);
    expect(assessment.estimatedRefundCents).toBe(0);
  });

  it('reports minCashFloor as the bare face when no refund is expected', () => {
    expect(call({ channel: 'FHR', creditFaceCents: CENTS(30_000) }).minCashFloorCents).toBe(30_000);
  });
});

// ------------------------------------------------------------------- ranking

describe('rankResults — §3.4 tie-breaks', () => {
  const resultWith = (over: Partial<ChannelResult>): ChannelResult =>
    ({
      ...evaluateChannel(quote('EDIT', 100_000), baseContext, 0),
      ...over,
    }) as ChannelResult;

  it('sorts ascending by effective net', () => {
    const ranked = rankResults([
      resultWith({ channel: 'OTA', effectiveNetCents: CENTS(300) }),
      resultWith({ channel: 'EDIT', effectiveNetCents: CENTS(100) }),
      resultWith({ channel: 'FHR', effectiveNetCents: CENTS(200) }),
    ]);
    expect(ranked.map((r) => r.result.channel)).toEqual(['EDIT', 'FHR', 'OTA']);
    expect(ranked.map((r) => r.deltaFromWinnerCents)).toEqual([0, 100, 200]);
  });

  it('breaks a tie by preferring the refundable option', () => {
    const ranked = rankResults([
      resultWith({ channel: 'OTA', effectiveNetCents: CENTS(100), refundable: false }),
      resultWith({ channel: 'EDIT', effectiveNetCents: CENTS(100), refundable: true }),
    ]);
    expect(ranked[0]?.result.channel).toBe('EDIT');
  });

  it('then by higher points value', () => {
    const ranked = rankResults([
      resultWith({
        channel: 'OTA',
        effectiveNetCents: CENTS(100),
        refundable: true,
        pointsValueCents: CENTS(10),
      }),
      resultWith({
        channel: 'EDIT',
        effectiveNetCents: CENTS(100),
        refundable: true,
        pointsValueCents: CENTS(90),
      }),
    ]);
    expect(ranked[0]?.result.channel).toBe('EDIT');
  });

  it('then by the §2.2 channel order', () => {
    const shared = { effectiveNetCents: CENTS(100), refundable: true, pointsValueCents: CENTS(0) };
    const ranked = rankResults([
      resultWith({ channel: 'OTA', ...shared }),
      resultWith({ channel: 'FHR', ...shared }),
      resultWith({ channel: 'EDIT', ...shared }),
    ]);
    expect(ranked.map((r) => r.result.channel)).toEqual(['FHR', 'EDIT', 'OTA']);
  });

  it('falls back to input index so two identical quotes still order deterministically', () => {
    const shared = {
      channel: 'EDIT' as Channel,
      effectiveNetCents: CENTS(100),
      refundable: true,
      pointsValueCents: CENTS(0),
    };
    expect(compareResults(resultWith({ ...shared, quoteIndex: 1 }), resultWith({ ...shared, quoteIndex: 0 }))).toBeGreaterThan(0);
    expect(compareResults(resultWith({ ...shared, quoteIndex: 0 }), resultWith({ ...shared, quoteIndex: 1 }))).toBeLessThan(0);
  });

  it('returns no winner for an empty result set', () => {
    expect(winnerOf([])).toBeNull();
    expect(rankResults([])).toEqual([]);
  });

  it('returns the cheapest as winner', () => {
    const winner = winnerOf([
      resultWith({ channel: 'OTA', effectiveNetCents: CENTS(300) }),
      resultWith({ channel: 'EDIT', effectiveNetCents: CENTS(100) }),
    ]);
    expect(winner?.channel).toBe('EDIT');
  });
});

// ----------------------------------------------------------------- BRG forks

describe('evaluateBrg — §3.5 and §2.3.3', () => {
  const ctx = (over: Partial<StayContext> = {}): StayContext => ({
    ...baseContext,
    competitorBaseCents: CENTS(194_800),
    brand: 'HYATT',
    ...over,
  });

  it('returns null when the property has no chain brand', () => {
    expect(evaluateBrg(CENTS(230_000), ctx({ brand: 'NONE' }), 'NONE')).toBeNull();
  });

  it('returns null when no competing rate has been entered', () => {
    expect(evaluateBrg(CENTS(230_000), ctx({ competitorBaseCents: null }), 'HYATT')).toBeNull();
  });

  it('returns null when our own rate is already at or below the competitor', () => {
    expect(evaluateBrg(CENTS(150_000), ctx(), 'HYATT')).toBeNull();
  });

  it('returns null when the competing rate is non-refundable — the universal denial cause', () => {
    expect(evaluateBrg(CENTS(230_000), ctx({ competitorRefundable: false }), 'HYATT')).toBeNull();
  });

  it('returns null when the competing rate is not publicly available', () => {
    expect(evaluateBrg(CENTS(230_000), ctx({ competitorPublic: false }), 'HYATT')).toBeNull();
  });

  it('applies Hyatt’s 20% kicker to the matched base', () => {
    const result = evaluateBrg(CENTS(230_000), ctx(), 'HYATT');
    expect(result?.matchedBaseCents).toBe(155_840);
    expect(result?.newTotalCents).toBe(175_164);
    expect(result?.pointsKicker).toBe(5_000);
    expect(result?.savingCents).toBe(54_836);
    expect(result?.claimWindowHours).toBe(24);
  });

  it('applies Hilton’s 25% kicker under a strict 1% relative floor', () => {
    const result = evaluateBrg(CENTS(230_000), ctx({ brand: 'HILTON' }), 'HILTON');
    expect(result?.discountBps).toBe(2_500);
    expect(result?.matchedBaseCents).toBe(146_100);
  });

  it('rejects a Hilton gap that does not strictly exceed 1% of the own base', () => {
    // Own base 204626 at 12.40% tax; 1% is 2046. A 2000-cent gap must fail.
    const context = ctx({ brand: 'HILTON', competitorBaseCents: CENTS(202_626) });
    expect(evaluateBrg(CENTS(230_000), context, 'HILTON')).toBeNull();
  });

  it('accepts a Marriott gap of exactly $1 per night — an inclusive minimum', () => {
    // 3 nights × 100 cents = 300 cents of gap exactly.
    const context = ctx({ brand: 'MARRIOTT', taxRateBps: 0, competitorBaseCents: CENTS(229_700) });
    expect(evaluateBrg(CENTS(230_000), context, 'MARRIOTT')).not.toBeNull();
  });

  it('rejects a Marriott gap one cent below the per-night minimum', () => {
    const context = ctx({ brand: 'MARRIOTT', taxRateBps: 0, competitorBaseCents: CENTS(229_701) });
    expect(evaluateBrg(CENTS(230_000), context, 'MARRIOTT')).toBeNull();
  });

  it('applies Marriott’s higher relative floor to a foreign-currency booking', () => {
    // 2% of a 230000 base is 4600. A 300-cent gap clears the absolute floor but
    // not the foreign-currency one.
    const context = ctx({ brand: 'MARRIOTT', taxRateBps: 0, competitorBaseCents: CENTS(229_700) });
    expect(evaluateBrg(CENTS(230_000), context, 'MARRIOTT', { foreignCurrency: true })).toBeNull();

    const wide = ctx({ brand: 'MARRIOTT', taxRateBps: 0, competitorBaseCents: CENTS(200_000) });
    expect(
      evaluateBrg(CENTS(230_000), wide, 'MARRIOTT', { foreignCurrency: true }),
    ).not.toBeNull();
  });

  it('applies Choice’s "greater of $1 or 1%" as the harder of the two floors', () => {
    // 3 nights → absolute floor 300; 1% of 230000 → 2300. The larger binds.
    const narrow = ctx({ brand: 'CHOICE', taxRateBps: 0, competitorBaseCents: CENTS(228_000) });
    expect(evaluateBrg(CENTS(230_000), narrow, 'CHOICE')).toBeNull();

    const wide = ctx({ brand: 'CHOICE', taxRateBps: 0, competitorBaseCents: CENTS(220_000) });
    const result = evaluateBrg(CENTS(230_000), wide, 'CHOICE');
    expect(result?.giftCardCents).toBe(5_000);
  });

  it('reports IHG’s kicker as text rather than fabricating a points figure', () => {
    const result = evaluateBrg(CENTS(230_000), ctx({ brand: 'IHG' }), 'IHG');
    expect(result?.pointsKicker).toBe(0);
    expect(result?.payoutDescription).toMatch(/5× points/);
    expect(result?.matchedBaseCents).toBe(194_800);
  });

  it('carries the per-brand frequency limit through', () => {
    const wyndham = evaluateBrg(CENTS(230_000), ctx({ brand: 'WYNDHAM' }), 'WYNDHAM');
    expect(wyndham?.frequencyLimit).toMatch(/calendar month/);
    expect(wyndham?.pointsKicker).toBe(3_000);

    const bestWestern = evaluateBrg(CENTS(230_000), ctx({ brand: 'BEST_WESTERN' }), 'BEST_WESTERN');
    expect(bestWestern?.giftCardCents).toBe(10_000);
    expect(bestWestern?.frequencyLimit).toMatch(/30 days/);

    const hyatt = evaluateBrg(CENTS(230_000), ctx(), 'HYATT');
    expect(hyatt?.frequencyLimit).toBeNull();
  });
});

// --------------------------------------------------------------- sensitivity

describe('analyseSensitivity — §8.7', () => {
  const Q: ChannelQuote[] = [
    quote('EDIT', 354_000),
    quote('FHR', 360_000),
    quote('DIRECT_PREPAID', 317_000, true, false),
    quote('DIRECT_FLEX', 350_000, false, true),
    quote('OTA', 360_000),
    quote('FORA', 350_000, false, true),
  ];

  it('returns null for an empty quote set', () => {
    expect(analyseSensitivity([], baseContext)).toBeNull();
  });

  it('reports no runner-up and no advantage for a single quote', () => {
    const report = analyseSensitivity([quote('EDIT', 354_000)], baseContext);
    expect(report?.runnerUp).toBeNull();
    expect(report?.advantageCents).toBe(0);
    expect(report?.pointsShareOfAdvantageBps).toBe(0);
    expect(report?.pointsDominates).toBe(false);
  });

  it('finds the downward UR break-even for TC-01', () => {
    const report = analyseSensitivity(Q, baseContext);
    expect(report?.urBreakEvenMicro).toBeCloseTo(4_399.5, 0);
  });

  it('flags that the TC-01 win rests substantially on points', () => {
    const report = analyseSensitivity(Q, baseContext);
    // Winner beats runner-up by 32914; the points delta is 16967 of it.
    expect(report?.advantageCents).toBe(32_914);
    expect(report?.pointsShareOfAdvantageBps).toBe(5_155);
    expect(report?.pointsDominates).toBe(true);
  });

  it('reports no break-even when devaluing points cannot change the winner', () => {
    // A single channel can never be overtaken.
    const report = analyseSensitivity([quote('EDIT', 354_000)], baseContext);
    expect(report?.urBreakEvenMicro).toBeNull();
    expect(report?.mrBreakEvenMicro).toBeNull();
  });

  it('finds an upward break-even when inflating a valuation flips the winner', () => {
    // FHR wins on cash at these rates; inflating Membership Rewards cannot help
    // EDIT, but inflating it far enough makes FHR overtake from below.
    const context: StayContext = { ...baseContext, mrValueMicro: 0, urValueMicro: 17_500 };
    const report = analyseSensitivity([quote('EDIT', 354_000), quote('FHR', 355_000)], context);
    expect(report?.winner).toBe('EDIT');
    expect(report?.mrBreakEvenMicro).not.toBeNull();
    expect(report?.mrBreakEvenMicro).toBeGreaterThan(0);
  });

  it('reports zero points share when the advantage is entirely cash', () => {
    const report = analyseSensitivity(
      [quote('DIRECT_FLEX', 100_000, false, true), quote('DIRECT_PREPAID', 200_000, true, false)],
      baseContext,
    );
    expect(report?.pointsShareOfAdvantageBps).toBe(0);
    expect(report?.pointsDominates).toBe(false);
  });
});

// ------------------------------------------------------------- engine facade

describe('SavingsEngine', () => {
  it('exposes the engine version used to stamp snapshots', () => {
    expect(new SavingsEngine().version).toBe('1.0.0');
  });

  it('skips sensitivity when asked to, for hot paths', () => {
    const outcome = new SavingsEngine({ includeSensitivity: false }).compare({
      context: baseContext,
      quotes: [quote('EDIT', 354_000), quote('FHR', 360_000)],
    });
    expect(outcome.sensitivity).toBeNull();
    expect(outcome.warnings).not.toContain('POINTS_DOMINATES');
  });

  it('emits POINTS_DOMINATES when the win rests on a valuation', () => {
    const outcome = new SavingsEngine().compare({
      context: baseContext,
      quotes: [quote('EDIT', 354_000), quote('FHR', 360_000)],
    });
    expect(outcome.warnings).toContain('POINTS_DOMINATES');
  });

  it('returns no BRG when the property has a brand but no direct quote was entered', () => {
    const outcome = new SavingsEngine().compare({
      context: { ...baseContext, brand: 'HYATT', competitorBaseCents: CENTS(194_800) },
      quotes: [quote('EDIT', 236_000)],
    });
    expect(outcome.brg).toBeNull();
  });

  it('picks the cheapest BRG-eligible direct quote', () => {
    const outcome = new SavingsEngine().compare({
      context: { ...baseContext, brand: 'HYATT', competitorBaseCents: CENTS(194_800) },
      quotes: [
        quote('EDIT', 236_000),
        quote('DIRECT_FLEX', 260_000, false, true),
        quote('DIRECT_FLEX', 230_000, false, true),
      ],
    });
    expect(outcome.brg?.originalTotalCents).toBe(230_000);
  });

  it('warns when the chain guarantee would beat the current winner — as a fork, not a sum', () => {
    const outcome = new SavingsEngine().compare({
      context: { ...baseContext, brand: 'HYATT', competitorBaseCents: CENTS(100_000) },
      quotes: [quote('EDIT', 900_000), quote('DIRECT_FLEX', 400_000, false, true)],
    });
    expect(outcome.warnings).toContain('BRG_AVAILABLE_NOT_TAKEN');
  });

  it('returns an empty comparison rather than throwing on no quotes', () => {
    const outcome = new SavingsEngine().compare({ context: baseContext, quotes: [] });
    expect(outcome.winner).toBeNull();
    expect(outcome.results).toEqual([]);
    expect(outcome.sensitivity).toBeNull();
  });

  it('evaluates a single quote for the per-figure formula hover', () => {
    const result = new SavingsEngine().evaluateOne(quote('EDIT', 354_000), baseContext);
    expect(result.effectiveNetCents).toBe(239_086);
  });

  it('honours an explicit user label over the generated one', () => {
    const outcome = new SavingsEngine().compare({
      context: baseContext,
      quotes: [{ ...quote('EDIT', 354_000), label: 'Edit — king suite' }],
    });
    expect(outcome.results[0]?.label).toBe('Edit — king suite');
  });
});

describe('buildQuoteLabels — §3.6', () => {
  it('leaves a single occurrence unsuffixed', () => {
    expect(buildQuoteLabels([quote('EDIT', 1), quote('FHR', 1)])).toEqual([
      'Chase The Edit',
      'Amex Fine Hotels + Resorts',
    ]);
  });

  it('suffixes repeats by 1-based index without deduping', () => {
    expect(buildQuoteLabels([quote('EDIT', 1), quote('EDIT', 2), quote('FHR', 3)])).toEqual([
      'Chase The Edit (1)',
      'Chase The Edit (2)',
      'Amex Fine Hotels + Resorts',
    ]);
  });

  it('preserves an explicit label verbatim', () => {
    expect(buildQuoteLabels([{ ...quote('EDIT', 1), label: 'Mine' }, quote('EDIT', 2)])).toEqual([
      'Mine',
      'Chase The Edit (1)',
    ]);
  });
});

// ------------------------------------------------------------------ profiler

describe('EngineProfiler — DECISIONS.md D-041', () => {
  it('reads no clock at all when disabled, keeping the engine pure', () => {
    expect(NULL_PROFILER.now()).toBe(0);
    expect(NULL_PROFILER.record('step', 5)).toBeUndefined();
  });

  it('records per-step timings when explicitly enabled', () => {
    let tick = 0;
    const profiler = new RecordingProfiler(() => (tick += 10));
    const engine = new SavingsEngine({ profiler });

    engine.compare({ context: baseContext, quotes: [quote('EDIT', 354_000)] });

    const steps = profiler.entries.map((e) => e.step);
    expect(steps).toContain('evaluate');
    expect(steps).toContain('rank');
    expect(steps).toContain('brg');
    expect(steps).toContain('sensitivity');
    expect(Object.values(profiler.totals()).every((ms) => ms > 0)).toBe(true);
  });

  it('sums repeated samples per step and clears on reset', () => {
    const profiler = new RecordingProfiler(() => 0);
    profiler.record('evaluate', 3);
    profiler.record('evaluate', 4);
    expect(profiler.totals()).toEqual({ evaluate: 7 });
    profiler.reset();
    expect(profiler.entries).toEqual([]);
  });

  it('defaults to performance.now when no timer is supplied', () => {
    const spy = vi.spyOn(performance, 'now').mockReturnValue(42);
    const profiler = new RecordingProfiler();
    expect(profiler.now()).toBe(42);
    spy.mockRestore();
  });

  it('never changes a returned number', () => {
    const withoutProfiler = new SavingsEngine().compare({
      context: baseContext,
      quotes: [quote('EDIT', 354_000)],
    });
    const withProfiler = new SavingsEngine({ profiler: new RecordingProfiler(() => 0) }).compare({
      context: baseContext,
      quotes: [quote('EDIT', 354_000)],
    });
    expect(JSON.stringify(withProfiler)).toBe(JSON.stringify(withoutProfiler));
  });
});

// ------------------------------------------------------------------ warnings

describe('warning copy — §12', () => {
  it('has copy for every warning the engine can emit', () => {
    const emitted = new Set<string>();
    for (const channel of CHANNEL_RANK_ORDER) {
      for (const prepaid of [true, false]) {
        for (const nights of [1, 3]) {
          const result = evaluateChannel(quote(channel, 40_000, prepaid, true), {
            ...baseContext,
            nights,
            competitorBaseCents: CENTS(13_350),
          });
          result.warnings.forEach((w) => emitted.add(w));
        }
      }
    }
    expect(emitted.size).toBeGreaterThan(0);
    for (const warning of emitted) {
      expect(WARNING_COPY[warning as keyof typeof WARNING_COPY]).toBeDefined();
    }
  });

  it('never promises a guaranteed refund anywhere in warning copy', () => {
    for (const entry of Object.values(WARNING_COPY)) {
      const text = `${entry.title} ${entry.detail}`.toLowerCase();
      expect(text).not.toMatch(/guaranteed savings|refund is guaranteed|we guarantee/);
    }
  });
});
