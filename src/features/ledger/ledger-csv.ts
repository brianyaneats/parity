import { SOURCE_DEFINITIONS, type SavingsEventKind } from './ledger-aggregate';

/**
 * CSV export — §7.7: "Include a CSV export."
 *
 * A hand-rolled RFC 4180 writer rather than a dependency: the shape is one
 * flat row per event and the only hard part is escaping, which is a few
 * lines. No library is installed for this and the task instructions ask for
 * no new charting dependency; the same reasoning extends to not pulling in a
 * CSV package for six columns.
 */

export interface LedgerCsvRow {
  readonly id: string;
  readonly occurredOn: string;
  readonly kind: SavingsEventKind;
  readonly amountCents: number;
  readonly realized: boolean;
  readonly note: string | null;
  readonly bookingId: string | null;
}

const HEADER = ['Date', 'Source', 'Amount', 'Status', 'Note', 'Booking ID'] as const;

const LABEL_BY_KIND: Readonly<Record<SavingsEventKind, string>> = Object.fromEntries(
  SOURCE_DEFINITIONS.map((def) => [def.kind, def.label]),
) as Record<SavingsEventKind, string>;

/**
 * RFC 4180 field escaping: a field containing a comma, a double quote, or a
 * line break is wrapped in double quotes, with internal quotes doubled. Every
 * other field is left bare — quoting everything is legal CSV too, but it
 * makes the common case (a plain date or dollar amount) needlessly noisy to
 * eyeball or diff.
 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** `239086` → `"2390.86"` — plain decimal, no currency symbol or thousands
 * separator, because a spreadsheet should parse the column as a number. */
function centsToDecimalString(amountCents: number): string {
  const sign = amountCents < 0 ? '-' : '';
  const abs = Math.abs(amountCents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  return `${sign}${dollars}.${remainder}`;
}

/**
 * Builds the full CSV text, header included. Rows are emitted in the order
 * given — callers pass already-sorted (typically newest-first) event lists.
 */
export function toCsv(rows: readonly LedgerCsvRow[]): string {
  const lines = [HEADER.map(escapeCsvField).join(',')];

  for (const row of rows) {
    const fields = [
      row.occurredOn,
      LABEL_BY_KIND[row.kind] ?? row.kind,
      centsToDecimalString(row.amountCents),
      row.realized ? 'Realized' : 'Projected',
      row.note ?? '',
      row.bookingId ?? '',
    ];
    lines.push(fields.map(escapeCsvField).join(','));
  }

  // CRLF per RFC 4180 — Excel's Windows build mis-parses bare `\n` in some
  // locales; CRLF is accepted everywhere a plain `\n` is.
  return lines.join('\r\n');
}
