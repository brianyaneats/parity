import { describe, it, expect } from 'vitest';
import {
  SavingsEvent,
  totalsFor,
  breakdownBySource,
  cumulativeSeries,
  withinRange,
  toCsv,
  SAVINGS_EVENT_KINDS,
  type SavingsEventKind,
} from './SavingsEvent';

/**
 * §8.6 and §1.5's fourth success criterion: "the savings ledger's cumulative
 * figure survives the user's own audit — i.e., every number is traceable to
 * inputs they recognize." Conflating projected with realized would fail it, so
 * most of these tests are about keeping the two apart.
 */

let counter = 0;
function event(over: Partial<Parameters<typeof SavingsEvent.create>[0]> = {}): SavingsEvent {
  return SavingsEvent.create({
    id: `event-${(counter += 1)}`,
    userId: 'user-1',
    kind: 'PRICE_MATCH',
    amountCents: 10_000,
    realized: true,
    occurredOn: '2026-07-27',
    claimId: 'claim-1',
    ...over,
  });
}

describe('SavingsEvent invariants', () => {
  it('rejects a fractional amount — money is integer cents', () => {
    expect(() => event({ amountCents: 100.5 })).toThrow(/integer cents/);
  });

  it('rejects a malformed date', () => {
    expect(() => event({ occurredOn: '27 July 2026' })).toThrow(/ISO date/);
  });

  it('refuses a realized saving with nothing to trace it to', () => {
    // §1.5's audit criterion fails the moment a banked figure has no source.
    expect(() =>
      event({ realized: true, claimId: null, bookingId: null }),
    ).toThrow(/must reference the booking or claim/);
  });

  it('allows a projected saving with no source, since nothing has happened yet', () => {
    expect(() =>
      event({ realized: false, claimId: null, bookingId: null }),
    ).not.toThrow();
  });

  it('carries a human label for the by-source breakdown', () => {
    expect(event({ kind: 'CREDIT_BURNED' }).label).toBe('Credits burned');
  });
});

describe('totalsFor — realized and projected never merge', () => {
  it('keeps the two figures separate', () => {
    const totals = totalsFor([
      event({ amountCents: 10_000, realized: true }),
      event({ amountCents: 25_000, realized: true, kind: 'CREDIT_BURNED', bookingId: 'b1' }),
      event({ amountCents: 90_000, realized: false, claimId: null, kind: 'CHANNEL_CHOICE' }),
    ]);

    expect(totals.realizedCents).toBe(35_000);
    expect(totals.projectedCents).toBe(90_000);
    expect(totals.eventCount).toBe(3);
  });

  it('returns a totals object with no combined field to reach for', () => {
    // A caller that wants one number has to write the addition itself, and in
    // doing so notice that it is mixing banked with expected.
    const totals = totalsFor([]);
    expect(Object.keys(totals).sort()).toEqual(['eventCount', 'projectedCents', 'realizedCents']);
  });

  it('reports zeroes for an empty ledger rather than throwing', () => {
    expect(totalsFor([])).toEqual({ realizedCents: 0, projectedCents: 0, eventCount: 0 });
  });
});

describe('breakdownBySource — §7.7', () => {
  const events = [
    event({ kind: 'PRICE_MATCH', amountCents: 10_000, realized: true }),
    event({ kind: 'CREDIT_BURNED', amountCents: 55_000, realized: true, bookingId: 'b1' }),
    event({ kind: 'CHANNEL_CHOICE', amountCents: 32_914, realized: false, claimId: null }),
    event({ kind: 'PERK', amountCents: 31_000, realized: true, bookingId: 'b1' }),
  ];

  it('returns every source, including ones with no events', () => {
    // The list must not silently reshape itself between visits.
    const rows = breakdownBySource(events);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.kind).sort()).toEqual([...SAVINGS_EVENT_KINDS].sort());
  });

  it('ranks by realized value, the honest measure of what earned its keep', () => {
    const rows = breakdownBySource(events);
    expect(rows[0]?.kind).toBe('CREDIT_BURNED');
    expect(rows[0]?.realizedCents).toBe(55_000);
    expect(rows[1]?.kind).toBe('PERK');
    expect(rows[2]?.kind).toBe('PRICE_MATCH');
  });

  it('keeps a projected-only source out of the realized ranking but still shows it', () => {
    const rows = breakdownBySource(events);
    const channelChoice = rows.find((r) => r.kind === 'CHANNEL_CHOICE');
    expect(channelChoice?.realizedCents).toBe(0);
    expect(channelChoice?.projectedCents).toBe(32_914);
  });

  it('orders deterministically when values tie, so the list never flickers', () => {
    const tied = [
      event({ kind: 'BRG', amountCents: 1_000, realized: true, bookingId: 'b' }),
      event({ kind: 'RESHOP', amountCents: 1_000, realized: true, bookingId: 'b' }),
    ];
    const first = breakdownBySource(tied).map((r) => r.kind);
    const second = breakdownBySource([...tied].reverse()).map((r) => r.kind);
    expect(first).toEqual(second);
  });

  it('has six sources, which is why §7.7 specifies a ranked list and not a chart', () => {
    // §6.5 rule 1 caps categorical series at three; §13.3 forbids "improving"
    // this into a six-colour pie.
    expect(SAVINGS_EVENT_KINDS).toHaveLength(6);
    expect(SAVINGS_EVENT_KINDS.length).toBeGreaterThan(3);
  });
});

describe('cumulativeSeries — the two-series chart', () => {
  it('accumulates each series independently in date order', () => {
    const series = cumulativeSeries([
      event({ occurredOn: '2026-03-01', amountCents: 10_000, realized: true }),
      event({ occurredOn: '2026-02-01', amountCents: 5_000, realized: true, bookingId: 'b' }),
      event({ occurredOn: '2026-03-01', amountCents: 20_000, realized: false, claimId: null }),
    ]);

    expect(series.map((p) => p.date)).toEqual(['2026-02-01', '2026-03-01']);
    expect(series[0]?.realizedCents).toBe(5_000);
    expect(series[0]?.projectedCents).toBe(0);
    expect(series[1]?.realizedCents).toBe(15_000);
    expect(series[1]?.projectedCents).toBe(20_000);
  });

  it('produces exactly two series, inside §6.5’s cap of three', () => {
    const point = cumulativeSeries([event()])[0];
    expect(Object.keys(point ?? {}).sort()).toEqual([
      'date',
      'projectedCents',
      'realizedCents',
    ]);
  });

  it('returns an empty series for an empty ledger', () => {
    expect(cumulativeSeries([])).toEqual([]);
  });
});

describe('withinRange', () => {
  const events = [
    event({ occurredOn: '2026-01-15' }),
    event({ occurredOn: '2026-06-30' }),
    event({ occurredOn: '2026-07-01' }),
  ];

  it('includes both ends of the range', () => {
    expect(withinRange(events, '2026-01-15', '2026-07-01')).toHaveLength(3);
    expect(withinRange(events, '2026-01-16', '2026-06-30')).toHaveLength(1);
  });

  it('treats an open end as unbounded', () => {
    expect(withinRange(events, '2026-07-01')).toHaveLength(1);
    expect(withinRange(events, undefined, '2026-01-15')).toHaveLength(1);
    expect(withinRange(events)).toHaveLength(3);
  });
});

describe('toCsv — §7.7 export', () => {
  it('emits a header and one row per event', () => {
    const csv = toCsv([event({ amountCents: 10_000, occurredOn: '2026-07-27' })]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('date,source,amount_usd,status,booking_id,claim_id,note');
    expect(lines[1]).toContain('2026-07-27,Price match,100.00,banked');
  });

  it('spells the status as a word so a spreadsheet total cannot silently mix the two', () => {
    const csv = toCsv([
      event({ realized: true }),
      event({ realized: false, claimId: null, kind: 'CHANNEL_CHOICE' }),
    ]);
    expect(csv).toContain(',banked,');
    expect(csv).toContain(',projected,');
    expect(csv).not.toContain('TRUE');
    expect(csv).not.toContain('FALSE');
  });

  it('escapes a note containing a comma or a quote', () => {
    const csv = toCsv([event({ note: 'Approved, but only $100 of a "courtesy" match' })]);
    expect(csv).toContain('"Approved, but only $100 of a ""courtesy"" match"');
  });

  it('exports an empty ledger as a header alone', () => {
    expect(toCsv([])).toBe('date,source,amount_usd,status,booking_id,claim_id,note');
  });

  it('renders cents as dollars with two decimals', () => {
    expect(toCsv([event({ amountCents: 7 })])).toContain(',0.07,');
    expect(toCsv([event({ amountCents: 239_086 })])).toContain(',2390.86,');
  });
});

describe('every declared kind has a label', () => {
  it.each(SAVINGS_EVENT_KINDS)('%s', (kind: SavingsEventKind) => {
    expect(event({ kind, bookingId: 'b' }).label.length).toBeGreaterThan(0);
  });
});
