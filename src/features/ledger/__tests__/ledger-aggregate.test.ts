import { describe, expect, it } from 'vitest';
import {
  SOURCE_DEFINITIONS,
  buildCumulativeSeries,
  buildSourceBreakdown,
  sumProjectedCents,
  sumRealizedCents,
  type LedgerAmountEvent,
} from '../ledger-aggregate';

/**
 * §8.6 / §13.3: the two behaviors under test throughout this file —
 * (1) realized and projected are never summed into one figure, and
 * (2) the by-source list always has exactly the six declared rows, even at
 * zero events, per the task's explicit test requirement.
 */

const event = (overrides: Partial<LedgerAmountEvent>): LedgerAmountEvent => ({
  kind: 'CHANNEL_CHOICE',
  amountCents: 1000,
  realized: true,
  occurredOn: '2026-01-01',
  ...overrides,
});

describe('buildCumulativeSeries', () => {
  it('returns one point per distinct date, sorted ascending', () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-03-01', amountCents: 500 }),
      event({ occurredOn: '2026-01-15', amountCents: 200 }),
      event({ occurredOn: '2026-02-01', amountCents: 300 }),
    ]);

    expect(points.map((p) => p.occurredOn)).toEqual(['2026-01-15', '2026-02-01', '2026-03-01']);
  });

  it('collapses same-day events into one point', () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-01-01', amountCents: 100 }),
      event({ occurredOn: '2026-01-01', amountCents: 200 }),
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]?.realizedCumulativeCents).toBe(300);
  });

  it('accumulates realized and projected as two independent running sums', () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-01-01', amountCents: 1000, realized: true }),
      event({ occurredOn: '2026-01-02', amountCents: 400, realized: false }),
      event({ occurredOn: '2026-01-03', amountCents: 600, realized: true }),
    ]);

    expect(points).toEqual([
      { occurredOn: '2026-01-01', realizedCumulativeCents: 1000, projectedCumulativeCents: 0 },
      { occurredOn: '2026-01-02', realizedCumulativeCents: 1000, projectedCumulativeCents: 400 },
      { occurredOn: '2026-01-03', realizedCumulativeCents: 1600, projectedCumulativeCents: 400 },
    ]);
  });

  it('returns an empty series for no events', () => {
    expect(buildCumulativeSeries([])).toEqual([]);
  });
});

describe('buildSourceBreakdown', () => {
  it('always returns exactly the six declared sources, even with zero events', () => {
    const rows = buildSourceBreakdown([]);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.kind))).toEqual(
      new Set(SOURCE_DEFINITIONS.map((d) => d.kind)),
    );
    expect(rows.every((r) => r.totalCents === 0 && r.eventCount === 0)).toBe(true);
  });

  it('keeps realized and projected separate within a source', () => {
    const rows = buildSourceBreakdown([
      event({ kind: 'PRICE_MATCH', amountCents: 5000, realized: true }),
      event({ kind: 'PRICE_MATCH', amountCents: 1200, realized: false }),
    ]);
    const priceMatch = rows.find((r) => r.kind === 'PRICE_MATCH');
    expect(priceMatch?.realizedCents).toBe(5000);
    expect(priceMatch?.projectedCents).toBe(1200);
    expect(priceMatch?.totalCents).toBe(6200);
    expect(priceMatch?.eventCount).toBe(2);
  });

  it('ranks by total descending', () => {
    const rows = buildSourceBreakdown([
      event({ kind: 'PERK', amountCents: 100 }),
      event({ kind: 'BRG', amountCents: 9000 }),
      event({ kind: 'RESHOP', amountCents: 4500 }),
    ]);
    expect(rows[0]?.kind).toBe('BRG');
    expect(rows[1]?.kind).toBe('RESHOP');
    expect(rows.at(-1)?.totalCents).toBe(0);
  });

  it('ignores an event whose kind is not one of the six known sources', () => {
    const rows = buildSourceBreakdown([
      event({ kind: 'SOME_FUTURE_KIND' as LedgerAmountEvent['kind'], amountCents: 5000 }),
    ]);
    expect(rows.reduce((sum, r) => sum + r.totalCents, 0)).toBe(0);
  });
});

describe('sumRealizedCents / sumProjectedCents', () => {
  it('never mixes the two totals', () => {
    const events = [
      event({ amountCents: 1000, realized: true }),
      event({ amountCents: 250, realized: false }),
      event({ amountCents: 750, realized: true }),
    ];
    expect(sumRealizedCents(events)).toBe(1750);
    expect(sumProjectedCents(events)).toBe(250);
  });

  it('returns zero for no events', () => {
    expect(sumRealizedCents([])).toBe(0);
    expect(sumProjectedCents([])).toBe(0);
  });
});
