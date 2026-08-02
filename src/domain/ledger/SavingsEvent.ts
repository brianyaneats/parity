import { ValueObject } from '../shared/ValueObject';
import { InvariantViolationError } from '../shared/DomainError';
import { type Cents, cents } from '../shared/cents';

/**
 * The savings ledger — §8.6.
 *
 * "Distinguish **projected** (the comparison said you'd save this) from
 * **realized** (a claim was approved, a credit was burned, a booking was made).
 * Only realized figures appear in the headline. Projected appears in a lighter
 * series with a label. Conflating them would fail the auditability criterion in
 * §1.5."
 *
 * That criterion is worth restating because it is what this module exists to
 * satisfy: *"the savings ledger's cumulative figure survives the user's own
 * audit — i.e., every number is traceable to inputs they recognize."*
 *
 * So every event carries the booking or claim it came from, and the realized
 * flag is not a display hint — it is the thing that decides whether a number is
 * allowed into the headline at all.
 */

export type SavingsEventKind =
  | 'CHANNEL_CHOICE'
  | 'PRICE_MATCH'
  | 'CREDIT_BURNED'
  | 'BRG'
  | 'RESHOP'
  | 'PERK';

export const SAVINGS_EVENT_KINDS: readonly SavingsEventKind[] = Object.freeze([
  'CHANNEL_CHOICE',
  'PRICE_MATCH',
  'CREDIT_BURNED',
  'BRG',
  'RESHOP',
  'PERK',
]);

/**
 * Labels for the §7.7 by-source breakdown.
 *
 * Six sources against §6.5's hard cap of three categorical series is exactly
 * why §7.7 specifies a **ranked bar list** rather than a chart, and why §13.3
 * warns "Do not 'improve' it into a six-color pie."
 */
export const SAVINGS_EVENT_LABELS: Readonly<Record<SavingsEventKind, string>> = Object.freeze({
  CHANNEL_CHOICE: 'Channel choice',
  PRICE_MATCH: 'Price match',
  CREDIT_BURNED: 'Credits burned',
  BRG: 'Best-rate guarantee',
  RESHOP: 'Re-shop',
  PERK: 'Perks',
});

interface SavingsEventProps extends Record<string, unknown> {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string | null;
  readonly claimId: string | null;
  readonly kind: SavingsEventKind;
  readonly amountCents: Cents;
  /** Banked, not merely expected. Only these reach the headline. */
  readonly realized: boolean;
  /** `YYYY-MM-DD`. */
  readonly occurredOn: string;
  readonly note: string | null;
}

export class SavingsEvent extends ValueObject<SavingsEventProps> {
  private constructor(props: SavingsEventProps) {
    super(props);
  }

  public static create(props: {
    id: string;
    userId: string;
    kind: SavingsEventKind;
    amountCents: number;
    realized: boolean;
    occurredOn: string;
    bookingId?: string | null;
    claimId?: string | null;
    note?: string | null;
  }): SavingsEvent {
    if (!Number.isInteger(props.amountCents)) {
      throw new InvariantViolationError('A savings amount must be integer cents.', {
        amountCents: props.amountCents,
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(props.occurredOn)) {
      throw new InvariantViolationError('A savings event needs an ISO date.', {
        occurredOn: props.occurredOn,
      });
    }
    // A realized saving must be traceable to something that actually happened.
    // §1.5's audit criterion fails the moment a banked figure has no source.
    if (props.realized && !props.bookingId && !props.claimId) {
      throw new InvariantViolationError(
        'A realized saving must reference the booking or claim it came from.',
        { kind: props.kind },
      );
    }

    return new SavingsEvent({
      id: props.id,
      userId: props.userId,
      bookingId: props.bookingId ?? null,
      claimId: props.claimId ?? null,
      kind: props.kind,
      amountCents: cents(props.amountCents),
      realized: props.realized,
      occurredOn: props.occurredOn,
      note: props.note ?? null,
    });
  }

  public get id(): string {
    return this.props.id;
  }
  public get kind(): SavingsEventKind {
    return this.props.kind;
  }
  public get amountCents(): Cents {
    return this.props.amountCents;
  }
  public get realized(): boolean {
    return this.props.realized;
  }
  public get occurredOn(): string {
    return this.props.occurredOn;
  }
  public get bookingId(): string | null {
    return this.props.bookingId;
  }
  public get claimId(): string | null {
    return this.props.claimId;
  }
  public get note(): string | null {
    return this.props.note;
  }
  public get label(): string {
    return SAVINGS_EVENT_LABELS[this.props.kind];
  }
}

export interface LedgerTotals {
  /** Banked. The only figure allowed in the headline — §8.6. */
  readonly realizedCents: Cents;
  /** Expected but not yet banked. Rendered in a lighter series, always labelled. */
  readonly projectedCents: Cents;
  readonly eventCount: number;
}

export interface SourceBreakdownRow {
  readonly kind: SavingsEventKind;
  readonly label: string;
  readonly realizedCents: Cents;
  readonly projectedCents: Cents;
}

export interface CumulativePoint {
  readonly date: string;
  readonly realizedCents: Cents;
  readonly projectedCents: Cents;
}

/**
 * Headline totals.
 *
 * Realized and projected are returned as two separate figures and are never
 * summed into one. A caller that wants a combined number has to write the
 * addition itself and, in doing so, notice that it is doing it.
 */
export function totalsFor(events: readonly SavingsEvent[]): LedgerTotals {
  let realized = 0;
  let projected = 0;

  for (const event of events) {
    if (event.realized) realized += event.amountCents;
    else projected += event.amountCents;
  }

  return {
    realizedCents: cents(realized),
    projectedCents: cents(projected),
    eventCount: events.length,
  };
}

/**
 * The by-source breakdown, ranked by realized value descending — §7.7.
 *
 * Every kind is returned, including ones with no events, so the list does not
 * silently reshape itself between visits. Ranking is by *realized* value, since
 * that is the honest measure of which mechanism actually earned its keep.
 */
export function breakdownBySource(events: readonly SavingsEvent[]): readonly SourceBreakdownRow[] {
  const rows = SAVINGS_EVENT_KINDS.map((kind) => {
    let realized = 0;
    let projected = 0;
    for (const event of events) {
      if (event.kind !== kind) continue;
      if (event.realized) realized += event.amountCents;
      else projected += event.amountCents;
    }
    return {
      kind,
      label: SAVINGS_EVENT_LABELS[kind],
      realizedCents: cents(realized),
      projectedCents: cents(projected),
    };
  });

  return Object.freeze(
    [...rows].sort((a, b) => {
      if (b.realizedCents !== a.realizedCents) return b.realizedCents - a.realizedCents;
      if (b.projectedCents !== a.projectedCents) return b.projectedCents - a.projectedCents;
      // Stable, so the order never flickers between renders.
      return SAVINGS_EVENT_KINDS.indexOf(a.kind) - SAVINGS_EVENT_KINDS.indexOf(b.kind);
    }),
  );
}

/**
 * The cumulative series for the §7.7 chart — two series, realized and
 * projected, each a running total in date order.
 *
 * Exactly two series, which sits comfortably inside §6.5's cap of three.
 */
export function cumulativeSeries(events: readonly SavingsEvent[]): readonly CumulativePoint[] {
  const byDate = new Map<string, { realized: number; projected: number }>();

  for (const event of events) {
    const bucket = byDate.get(event.occurredOn) ?? { realized: 0, projected: 0 };
    if (event.realized) bucket.realized += event.amountCents;
    else bucket.projected += event.amountCents;
    byDate.set(event.occurredOn, bucket);
  }

  let realizedRunning = 0;
  let projectedRunning = 0;

  return Object.freeze(
    [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => {
        realizedRunning += bucket.realized;
        projectedRunning += bucket.projected;
        return {
          date,
          realizedCents: cents(realizedRunning),
          projectedCents: cents(projectedRunning),
        };
      }),
  );
}

/** Filters to a date range, both ends inclusive. Powers `?from=&to=`. */
export function withinRange(
  events: readonly SavingsEvent[],
  from?: string,
  to?: string,
): readonly SavingsEvent[] {
  return events.filter(
    (event) =>
      (from === undefined || event.occurredOn >= from) &&
      (to === undefined || event.occurredOn <= to),
  );
}

/**
 * CSV export — §7.7.
 *
 * The `realized` column is exported as an explicit word rather than a boolean,
 * because a spreadsheet that shows `TRUE`/`FALSE` invites the user to sum the
 * whole amount column and get a number that mixes banked with expected.
 */
export function toCsv(events: readonly SavingsEvent[]): string {
  const header = 'date,source,amount_usd,status,booking_id,claim_id,note';
  const rows = events.map((event) =>
    [
      event.occurredOn,
      csvEscape(event.label),
      (event.amountCents / 100).toFixed(2),
      event.realized ? 'banked' : 'projected',
      event.bookingId ?? '',
      event.claimId ?? '',
      csvEscape(event.note ?? ''),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
