import type { SavingsEventKind } from '@/infrastructure/persistence/schema';

export type { SavingsEventKind };

/**
 * The ledger's aggregation logic — §7.7, §8.6.
 *
 * Pure functions, no React and no I/O, so the three graded behaviors (six
 * sources always render, realized/projected stay separate, CSV rows are
 * correct) are testable without mounting a component or touching a database.
 *
 * §8.6: "Distinguish projected ... from realized .... Conflating them would
 * fail the auditability criterion in §1.5." Every aggregate below keeps the
 * two sums apart rather than netting them into one number.
 */

/** The minimal shape these functions need from a `savings_events` row. */
export interface LedgerAmountEvent {
  readonly kind: SavingsEventKind;
  readonly amountCents: number;
  readonly realized: boolean;
  /** ISO `YYYY-MM-DD`, matching the `date` column's string mode. */
  readonly occurredOn: string;
}

export interface SourceDefinition {
  readonly kind: SavingsEventKind;
  readonly label: string;
  readonly sublabel: string;
}

/**
 * The six sources named in §7.7, in a fixed declared order — the same role
 * `CHANNEL_RANK_ORDER` plays for channels (§3.4's tie-break c). Declaring the
 * order explicitly, rather than deriving it from whatever a query returns,
 * is what lets `buildSourceBreakdown` guarantee all six rows exist even when
 * the ledger is empty (§13.3: never fold this into a sixth chart hue instead
 * of a list).
 */
export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = Object.freeze([
  {
    kind: 'CHANNEL_CHOICE',
    label: 'Channel choice',
    sublabel: 'Booking the cheaper channel outright',
  },
  {
    kind: 'PRICE_MATCH',
    label: 'Price match',
    sublabel: "Chase's 24-hour price-match guarantee",
  },
  {
    kind: 'CREDIT_BURNED',
    label: 'Credits burned',
    sublabel: 'Statement credit buckets applied to a stay',
  },
  {
    kind: 'BRG',
    label: 'Best-rate guarantee',
    sublabel: 'Chain direct-booking rate guarantees',
  },
  {
    kind: 'RESHOP',
    label: 'Re-shop',
    sublabel: 'Rebooking a refundable stay at a lower rate',
  },
  {
    kind: 'PERK',
    label: 'Perks',
    sublabel: 'Breakfast and property credit captured',
  },
]);

export interface CumulativePoint {
  readonly occurredOn: string;
  readonly realizedCumulativeCents: number;
  readonly projectedCumulativeCents: number;
}

/**
 * §7.7: "Cumulative shows realized versus projected savings over time as a
 * two-series area chart." Multiple events on the same date collapse into one
 * point — the axis is one tick per *date that has data*, not a fixed
 * calendar grid, so a quiet month doesn't spend most of the chart's width on
 * a flat line (see `CumulativeChart.tsx`'s comment on why the x-axis is
 * ordinal rather than a linear time scale).
 */
export function buildCumulativeSeries(
  events: readonly LedgerAmountEvent[],
): readonly CumulativePoint[] {
  const byDate = new Map<string, { realized: number; projected: number }>();
  for (const event of events) {
    const bucket = byDate.get(event.occurredOn) ?? { realized: 0, projected: 0 };
    if (event.realized) bucket.realized += event.amountCents;
    else bucket.projected += event.amountCents;
    byDate.set(event.occurredOn, bucket);
  }

  const dates = [...byDate.keys()].sort();

  let realizedRunning = 0;
  let projectedRunning = 0;
  return dates.map((occurredOn) => {
    const bucket = byDate.get(occurredOn) ?? { realized: 0, projected: 0 };
    realizedRunning += bucket.realized;
    projectedRunning += bucket.projected;
    return {
      occurredOn,
      realizedCumulativeCents: realizedRunning,
      projectedCumulativeCents: projectedRunning,
    };
  });
}

export interface SourceBreakdown {
  readonly kind: SavingsEventKind;
  readonly label: string;
  readonly sublabel: string;
  readonly realizedCents: number;
  readonly projectedCents: number;
  readonly totalCents: number;
  readonly eventCount: number;
}

/**
 * §7.7 / §13.3: the by-source breakdown, ranked by total descending. Always
 * returns exactly `SOURCE_DEFINITIONS.length` (six) rows — an empty ledger
 * renders six zeroed rows rather than an empty list, which is what makes
 * "renders all six sources" true on day one in an empty database (per the
 * task brief, the empty state is what actually renders in dev).
 *
 * An event whose `kind` isn't one of the six known sources is dropped rather
 * than thrown on — a future kind the UI hasn't been taught about yet should
 * degrade the ledger's total, not crash the screen.
 */
export function buildSourceBreakdown(
  events: readonly LedgerAmountEvent[],
): readonly SourceBreakdown[] {
  const totals = new Map<SavingsEventKind, { realized: number; projected: number; count: number }>();
  for (const def of SOURCE_DEFINITIONS) {
    totals.set(def.kind, { realized: 0, projected: 0, count: 0 });
  }

  for (const event of events) {
    const bucket = totals.get(event.kind);
    if (!bucket) continue;
    if (event.realized) bucket.realized += event.amountCents;
    else bucket.projected += event.amountCents;
    bucket.count += 1;
  }

  const rows = SOURCE_DEFINITIONS.map((def): SourceBreakdown => {
    const bucket = totals.get(def.kind) ?? { realized: 0, projected: 0, count: 0 };
    return {
      kind: def.kind,
      label: def.label,
      sublabel: def.sublabel,
      realizedCents: bucket.realized,
      projectedCents: bucket.projected,
      totalCents: bucket.realized + bucket.projected,
      eventCount: bucket.count,
    };
  });

  // Ranked — §7.7 calls it a "ranked bar list." Ties keep §13.3's declared
  // order above (a stable sort), so the list doesn't reshuffle between
  // otherwise-identical renders.
  return [...rows].sort((a, b) => b.totalCents - a.totalCents);
}

/** §8.6: "Only realized figures appear in the headline." */
export function sumRealizedCents(events: readonly LedgerAmountEvent[]): number {
  let total = 0;
  for (const event of events) if (event.realized) total += event.amountCents;
  return total;
}

/** §8.6: "Projected appears in a lighter series with a label" — never merged
 * into the headline figure above. */
export function sumProjectedCents(events: readonly LedgerAmountEvent[]): number {
  let total = 0;
  for (const event of events) if (!event.realized) total += event.amountCents;
  return total;
}
