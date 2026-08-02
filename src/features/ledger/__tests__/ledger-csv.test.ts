import { describe, expect, it } from 'vitest';
import { escapeCsvField, toCsv, type LedgerCsvRow } from '../ledger-csv';

const row = (overrides: Partial<LedgerCsvRow>): LedgerCsvRow => ({
  id: 'evt_1',
  occurredOn: '2026-03-14',
  kind: 'PRICE_MATCH',
  amountCents: 23906,
  realized: true,
  note: null,
  bookingId: 'bk_1',
  ...overrides,
});

describe('escapeCsvField', () => {
  it('leaves a plain field untouched', () => {
    expect(escapeCsvField('2026-03-14')).toBe('2026-03-14');
  });

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('Tokyo, Japan')).toBe('"Tokyo, Japan"');
  });

  it('quotes and doubles internal quotes', () => {
    expect(escapeCsvField('Said "no" to the upsell')).toBe('"Said ""no"" to the upsell"');
  });

  it('quotes a field containing a newline', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('quotes a field containing a carriage return', () => {
    expect(escapeCsvField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });
});

describe('toCsv', () => {
  it('emits the header row first', () => {
    const csv = toCsv([]);
    expect(csv).toBe('Date,Source,Amount,Status,Note,Booking ID');
  });

  it('produces the right row for a realized event', () => {
    const csv = toCsv([row({})]);
    const lines = csv.split('\r\n');
    expect(lines).toEqual([
      'Date,Source,Amount,Status,Note,Booking ID',
      '2026-03-14,Price match,239.06,Realized,,bk_1',
    ]);
  });

  it('labels a projected event distinctly from a realized one', () => {
    const csv = toCsv([row({ realized: false })]);
    expect(csv).toContain('Projected');
    expect(csv).not.toContain(',Realized,');
  });

  it('maps every one of the six source kinds to its human label, not the raw enum', () => {
    const csv = toCsv([
      row({ kind: 'CHANNEL_CHOICE' }),
      row({ kind: 'CREDIT_BURNED' }),
      row({ kind: 'BRG' }),
      row({ kind: 'RESHOP' }),
      row({ kind: 'PERK' }),
    ]);
    expect(csv).toContain('Channel choice');
    expect(csv).toContain('Credits burned');
    expect(csv).toContain('Best-rate guarantee');
    expect(csv).toContain('Re-shop');
    expect(csv).toContain('Perks');
  });

  it('escapes a note containing a comma and embedded quotes', () => {
    const csv = toCsv([row({ note: 'Matched Marriott\'s "member rate", 12% below Edit' })]);
    expect(csv).toContain('"Matched Marriott\'s ""member rate"", 12% below Edit"');
  });

  it('renders a null note and null booking id as empty fields, not the string "null"', () => {
    const csv = toCsv([row({ note: null, bookingId: null })]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe('2026-03-14,Price match,239.06,Realized,,');
    expect(dataLine).not.toContain('null');
  });

  it('renders a negative amount with a leading minus, not a stray sign position', () => {
    const csv = toCsv([row({ amountCents: -150 })]);
    expect(csv).toContain('-1.50');
  });

  it('preserves row order', () => {
    const csv = toCsv([row({ id: 'a', occurredOn: '2026-01-01' }), row({ id: 'b', occurredOn: '2026-02-01' })]);
    const lines = csv.split('\r\n').slice(1);
    expect(lines[0]).toContain('2026-01-01');
    expect(lines[1]).toContain('2026-02-01');
  });
});
