import { describe, it, expect } from 'vitest';
import { computeChannelChoiceSavingCents, selectChannelChoiceBaseline } from './ChannelChoiceSaving';
import { cents } from '../shared/cents';
import type { ChannelResult } from '../engine/types';

/**
 * §8.6 / the task brief's money-math defect fix: `CHANNEL_CHOICE` must be
 * cash-only (sticker total vs. sticker total), never double-count the
 * credit or a soft valuation, and must reliably produce a baseline even
 * when the user entered no OTA quote. This module is the pure, directly
 * testable core of that fix — `RecordBookingUseCase.test.ts` covers the
 * integration wiring (event persistence, `realized: false`, no double
 * counting against `CREDIT_BURNED`).
 */

/** Minimal-but-valid `ChannelResult` fixture — only the fields under test need overriding. */
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

describe('computeChannelChoiceSavingCents — cash-only, no double-counting', () => {
  it('is sticker total minus sticker total, nothing else', () => {
    const baseline = channelResult({ channel: 'OTA', totalCents: cents(356_400) });
    const winner = channelResult({ channel: 'EDIT', totalCents: cents(354_000) });

    expect(computeChannelChoiceSavingCents(baseline, winner)).toBe(2_400);
  });

  it('ignores perks, points, credit, and refund entirely — only totalCents matters', () => {
    // Same totals as the previous test, but every soft/already-accounted
    // component is cranked up. If the formula leaked any of these in, the
    // result would move; it must not.
    const baseline = channelResult({
      channel: 'OTA',
      totalCents: cents(356_400),
      perksCents: cents(999_999),
      pointsValueCents: cents(999_999),
    });
    const winner = channelResult({
      channel: 'EDIT',
      totalCents: cents(354_000),
      creditKeptCents: cents(25_000),
      refundCents: cents(14_947),
      perksCents: cents(31_000),
      pointsValueCents: cents(43_967),
      // A deliberately unrealistic effectiveNetCents — if the formula ever
      // read this field again instead of totalCents, this assertion would
      // catch it immediately.
      effectiveNetCents: cents(1),
    });

    expect(computeChannelChoiceSavingCents(baseline, winner)).toBe(2_400);
  });

  it('floors at zero rather than returning a negative "choice" saving', () => {
    const baseline = channelResult({ channel: 'OTA', totalCents: cents(300_000) });
    const winner = channelResult({ channel: 'FHR', totalCents: cents(360_000) });

    expect(computeChannelChoiceSavingCents(baseline, winner)).toBe(0);
  });

  it('is zero, not negative, when the winner exactly matches the baseline', () => {
    const baseline = channelResult({ channel: 'OTA', totalCents: cents(300_000) });
    const winner = channelResult({ channel: 'OTA', totalCents: cents(300_000) });

    expect(computeChannelChoiceSavingCents(baseline, winner)).toBe(0);
  });
});

describe('selectChannelChoiceBaseline', () => {
  it('prefers the OTA row when present', () => {
    const rows = [
      channelResult({ channel: 'EDIT', totalCents: cents(354_000) }),
      channelResult({ channel: 'FHR', totalCents: cents(360_000) }),
      channelResult({ channel: 'OTA', totalCents: cents(356_400) }),
    ];

    const baseline = selectChannelChoiceBaseline(rows);

    expect(baseline?.row.channel).toBe('OTA');
    expect(baseline?.note).toBe('vs. OTA rate you entered');
  });

  it('falls back to the highest sticker total when there is no OTA row', () => {
    const rows = [
      channelResult({ channel: 'EDIT', totalCents: cents(354_000) }),
      channelResult({ channel: 'FHR', totalCents: cents(360_000) }),
      channelResult({ channel: 'DIRECT_PREPAID', totalCents: cents(317_000) }),
    ];

    const baseline = selectChannelChoiceBaseline(rows);

    expect(baseline?.row.channel).toBe('FHR');
    expect(baseline?.note).toBe('vs. the most expensive rate you entered');
  });

  it('returns null for an empty result set', () => {
    expect(selectChannelChoiceBaseline([])).toBeNull();
  });
});
