import { describe, it, expect } from 'vitest';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import { cents } from '@/domain/shared/cents';
import type { ChannelQuote, StayContext } from '@/domain/engine/types';
import { countChangedWinners, type SavedComparisonSummary } from '../sensitivity';

/**
 * §7.8's honesty feature, unit-tested against the real engine rather than a
 * stub — `countChangedWinners` exists to answer "does my saved decision still
 * hold at this valuation," so the test fixture is built so that raising the
 * UR valuation genuinely flips the winner (EDIT earns 8× Ultimate Rewards on
 * an uncredited charge; DIRECT_FLEX earns nothing), and the assertions below
 * are cross-checked against an independent `SavingsEngine` call rather than
 * a hand-derived number.
 */

const engine = new SavingsEngine({ includeSensitivity: false });

function buildContext(urValueMicro: number): StayContext {
  return {
    nights: 2,
    taxRateBps: 0,
    breakfastPerDayCents: cents(0),
    propertyCreditFaceCents: cents(0),
    realizationPct: 100,
    mrValueMicro: 0,
    urValueMicro,
    foraRateBps: 0,
    amexBucketAvailable: false,
    editBucketAvailable: false,
    competitorBaseCents: null,
    competitorRefundable: true,
    competitorPublic: true,
    brand: 'NONE',
  };
}

const quotes: readonly ChannelQuote[] = [
  { channel: 'DIRECT_FLEX', totalCents: cents(20_000), prepaid: false, refundable: true },
  { channel: 'EDIT', totalCents: cents(21_000), prepaid: true, refundable: true },
];

describe('countChangedWinners — §7.8 honesty feature', () => {
  it('reports zero changes when re-run at the same valuation the baseline was recorded at', () => {
    const baselineWinner = engine.compare({ context: buildContext(17_500), quotes }).winner?.channel ?? null;

    const comparisons: readonly SavedComparisonSummary[] = [
      {
        id: 'c1',
        propertyLabel: 'Test Hotel',
        originalWinner: baselineWinner,
        context: buildContext(17_500),
        quotes,
      },
    ];

    const outcome = countChangedWinners(comparisons, 0, 17_500);
    expect(outcome.total).toBe(1);
    expect(outcome.changed).toBe(0);
    expect(outcome.changedComparisons).toHaveLength(0);
  });

  it('flags a comparison as changed exactly when an independent recompute at the new valuation gives a different winner', () => {
    const lowWinner = engine.compare({ context: buildContext(0), quotes }).winner?.channel ?? null;
    const highWinner = engine.compare({ context: buildContext(200_000), quotes }).winner?.channel ?? null;

    // Sanity check on the fixture itself: it is only a meaningful test of
    // "does the winner change" if the two independently-computed winners
    // actually differ.
    expect(highWinner).not.toBe(lowWinner);

    const comparisons: readonly SavedComparisonSummary[] = [
      { id: 'c1', propertyLabel: 'Test Hotel', originalWinner: lowWinner, context: buildContext(0), quotes },
    ];

    const outcome = countChangedWinners(comparisons, 0, 200_000);

    expect(outcome.total).toBe(1);
    expect(outcome.changed).toBe(1);
    expect(outcome.changedComparisons[0]).toMatchObject({
      id: 'c1',
      propertyLabel: 'Test Hotel',
      from: lowWinner,
      to: highWinner,
    });
  });

  it('returns zero total and zero changed for an empty comparison list, with an empty changed list', () => {
    const outcome = countChangedWinners([], 15_000, 17_500);
    expect(outcome).toEqual({ total: 0, changed: 0, changedComparisons: [] });
  });

  it('counts multiple comparisons independently', () => {
    const stableWinner = engine.compare({ context: buildContext(0), quotes }).winner?.channel ?? null;

    const comparisons: readonly SavedComparisonSummary[] = [
      { id: 'stable', propertyLabel: 'Stable Hotel', originalWinner: stableWinner, context: buildContext(0), quotes },
      // A comparison whose recorded winner cannot possibly match anything the
      // engine returns, so it always counts as changed — a simple way to
      // exercise "some flip, some don't" in one call.
      { id: 'always-flips', propertyLabel: 'Flipped Hotel', originalWinner: null, context: buildContext(0), quotes },
    ];

    const outcome = countChangedWinners(comparisons, 0, 0);
    expect(outcome.total).toBe(2);
    expect(outcome.changed).toBe(1);
    expect(outcome.changedComparisons[0]?.id).toBe('always-flips');
  });
});
