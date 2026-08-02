import { describe, it, expect } from 'vitest';
import fixtures from './__fixtures__/engine.fixtures.json';
import { SavingsEngine } from './SavingsEngine';
import type { Cents } from '../shared/cents';
import type { Channel, ChannelQuote, ChannelResult, EngineWarning, StayContext } from './types';
import type { PmCondition } from '../rules/price-match.rules';

/**
 * The §3.8 table test — GROUND TRUTH.
 *
 * §0.2: "The test fixtures in §3.8. They are ground truth. If your
 * implementation disagrees with a fixture, your implementation is wrong."
 *
 * Every published number is asserted. Where the spec gave a partial row, only
 * the published fields are asserted — nothing is invented to fill a gap.
 */

interface ExpectedRow {
  channel: string;
  base?: number;
  tax?: number;
  perks?: number;
  creditFace?: number;
  creditKept?: number;
  clawback?: number;
  points?: number;
  refund?: number;
  netCharge?: number;
  net?: number;
  pmQualifies?: boolean;
  perNight?: number;
  gap?: number;
  minCashFloor?: number;
  warnings?: string[];
  failedConditions?: string[];
}

interface FixtureCase {
  id: string;
  title: string;
  contextOverrides: Partial<StayContext>;
  quoteSet?: string;
  quotes?: ChannelQuote[];
  expectedWinner: string;
  expectedRankedOrder?: string[];
  expectedRows: ExpectedRow[];
  expectedBrg?: {
    brand: string;
    newTotalCents: number;
    matchedBaseCents: number;
    pointsKicker: number;
  };
  expectedSensitivity?: { urBreakEvenMicro: number; toleranceMicro: number };
}

const sharedContext = fixtures.sharedContext as unknown as StayContext;
const sharedQuoteSets = fixtures.sharedQuoteSets as unknown as Record<string, ChannelQuote[]>;
const cases = fixtures.cases as unknown as FixtureCase[];

const engine = new SavingsEngine();

function contextFor(testCase: FixtureCase): StayContext {
  return { ...sharedContext, ...testCase.contextOverrides };
}

function quotesFor(testCase: FixtureCase): ChannelQuote[] {
  if (testCase.quotes) return testCase.quotes;
  const set = testCase.quoteSet ? sharedQuoteSets[testCase.quoteSet] : undefined;
  if (!set) throw new Error(`Fixture ${testCase.id} names no quotes`);
  return set;
}

function rowFor(results: readonly ChannelResult[], channel: string): ChannelResult {
  const match = results.find((r) => r.channel === channel);
  if (!match) throw new Error(`No result for channel ${channel}`);
  return match;
}

describe('§3.8 engine fixtures — ground truth', () => {
  for (const testCase of cases) {
    describe(`${testCase.id} — ${testCase.title}`, () => {
      const context = contextFor(testCase);
      const quotes = quotesFor(testCase);
      const outcome = engine.compare({ context, quotes });

      it('ranks the specified winner first', () => {
        expect(outcome.winner?.channel).toBe(testCase.expectedWinner);
      });

      if (testCase.expectedRankedOrder) {
        it('produces the specified ranked order', () => {
          expect(outcome.ranked.map((entry) => entry.result.channel)).toEqual(
            testCase.expectedRankedOrder,
          );
        });
      }

      for (const expected of testCase.expectedRows) {
        describe(expected.channel, () => {
          const actual = rowFor(outcome.results, expected.channel);

          if (expected.base !== undefined) {
            it(`base = ${expected.base}`, () => {
              expect(actual.baseCents).toBe(expected.base);
            });
          }
          if (expected.tax !== undefined) {
            it(`tax = ${expected.tax}`, () => {
              expect(actual.taxCents).toBe(expected.tax);
            });
          }
          if (expected.perks !== undefined) {
            it(`perks = ${expected.perks}`, () => {
              expect(actual.perksCents).toBe(expected.perks);
            });
          }
          if (expected.creditFace !== undefined) {
            it(`creditFace = ${expected.creditFace}`, () => {
              expect(actual.creditFaceCents).toBe(expected.creditFace);
            });
          }
          if (expected.creditKept !== undefined) {
            it(`creditKept = ${expected.creditKept}`, () => {
              expect(actual.creditKeptCents).toBe(expected.creditKept);
            });
          }
          if (expected.clawback !== undefined) {
            it(`clawback = ${expected.clawback}`, () => {
              expect(actual.clawbackCents).toBe(expected.clawback);
            });
          }
          if (expected.points !== undefined) {
            it(`points = ${expected.points}`, () => {
              expect(actual.pointsValueCents).toBe(expected.points);
            });
          }
          if (expected.refund !== undefined) {
            it(`refund = ${expected.refund}`, () => {
              expect(actual.refundCents).toBe(expected.refund);
            });
          }
          if (expected.netCharge !== undefined) {
            it(`netCharge = ${expected.netCharge}`, () => {
              expect(actual.totalCents - actual.refundCents).toBe(expected.netCharge);
            });
          }
          if (expected.net !== undefined) {
            it(`net = ${expected.net}`, () => {
              expect(actual.effectiveNetCents).toBe(expected.net);
            });
          }
          if (expected.pmQualifies !== undefined) {
            it(`pmQualifies = ${expected.pmQualifies}`, () => {
              expect(actual.priceMatch.qualifies).toBe(expected.pmQualifies);
            });
          }
          if (expected.perNight !== undefined) {
            it(`perNight = ${expected.perNight}`, () => {
              expect(actual.priceMatch.perNightCents).toBe(expected.perNight);
            });
          }
          if (expected.gap !== undefined) {
            it(`gap = ${expected.gap}`, () => {
              expect(actual.priceMatch.gapCents).toBe(expected.gap);
            });
          }
          if (expected.minCashFloor !== undefined) {
            it(`minCashFloor = ${expected.minCashFloor}`, () => {
              expect(actual.priceMatch.minCashFloorCents).toBe(expected.minCashFloor);
            });
          }
          if (expected.warnings) {
            it(`emits ${expected.warnings.join(', ')}`, () => {
              for (const warning of expected.warnings as EngineWarning[]) {
                expect(actual.warnings).toContain(warning);
              }
            });
          }
          if (expected.failedConditions) {
            it(`fails ${expected.failedConditions.join(', ')}`, () => {
              for (const condition of expected.failedConditions as PmCondition[]) {
                expect(actual.priceMatch.failedConditions).toContain(condition);
              }
            });
          }
        });
      }

      if (testCase.expectedBrg) {
        const brgExpectation = testCase.expectedBrg;
        describe('best-rate guarantee fork', () => {
          it(`matches to ${brgExpectation.matchedBaseCents} and totals ${brgExpectation.newTotalCents}`, () => {
            expect(outcome.brg).not.toBeNull();
            expect(outcome.brg?.brand).toBe(brgExpectation.brand);
            expect(outcome.brg?.matchedBaseCents).toBe(brgExpectation.matchedBaseCents);
            expect(outcome.brg?.newTotalCents).toBe(brgExpectation.newTotalCents);
            expect(outcome.brg?.pointsKicker).toBe(brgExpectation.pointsKicker);
          });

          it('never presents the BRG and the price match as additive', () => {
            // §3.5: they are mutually exclusive paths. The BRG result carries an
            // all-in total for the direct booking; it is never added to, nor
            // netted against, a portal channel's refund.
            const winnerRefund = outcome.winner?.refundCents ?? 0;
            expect(outcome.brg?.newTotalCents).toBe(brgExpectation.newTotalCents);
            expect(outcome.brg?.newTotalCents).not.toBe(
              brgExpectation.newTotalCents - winnerRefund,
            );
          });
        });
      }

      if (testCase.expectedSensitivity) {
        const expectation = testCase.expectedSensitivity;
        it(`UR break-even within ±${expectation.toleranceMicro} micro of ${expectation.urBreakEvenMicro}`, () => {
          const breakEven = outcome.sensitivity?.urBreakEvenMicro;
          expect(breakEven).not.toBeNull();
          expect(breakEven).toBeDefined();
          expect(Math.abs((breakEven as number) - expectation.urBreakEvenMicro)).toBeLessThanOrEqual(
            expectation.toleranceMicro,
          );
        });

        it('reports FHR as the channel that takes over below the break-even', () => {
          const breakEven = outcome.sensitivity?.urBreakEvenMicro as number;
          const below = engine.compare({
            context: { ...contextFor(testCase), urValueMicro: breakEven - 50 },
            quotes: quotesFor(testCase),
          });
          expect(below.winner?.channel).toBe('FHR');
        });
      }
    });
  }
});

describe('§3.8 TC-06 — the tripwire for the most likely implementation bug', () => {
  it('never applies Chase price-match logic to an Amex channel', () => {
    // §2.3.2: Amex's guarantee explicitly excludes Fine Hotels + Resorts and
    // The Hotel Collection. A $700 gap on FHR is unrecoverable, permanently.
    const context: StayContext = { ...sharedContext, competitorBaseCents: 250000 as Cents };
    const amexChannels: Channel[] = ['FHR', 'THC'];

    for (const channel of amexChannels) {
      const outcome = engine.compare({
        context,
        quotes: [{ channel, totalCents: 360000 as Cents, prepaid: true, refundable: true }],
      });
      const result = outcome.results[0];
      expect(result?.priceMatch.qualifies).toBe(false);
      expect(result?.priceMatch.channelEligible).toBe(false);
      expect(result?.refundCents).toBe(0);
      expect(result?.priceMatch.failedConditions).toContain('PM2');
      expect(result?.warnings).toContain('FHR_NO_PRICE_MATCH');
    }
  });
});
