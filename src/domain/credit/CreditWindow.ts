import type { CreditBucketDefinition, CreditWindowKind } from '../rules/credit.rules';

/**
 * Credit windows — §2.4.
 *
 * A bucket's window is data, not a constant: §2.4 says "Do not hardcode; seed
 * them." This module computes the concrete start and end dates a seed row gets.
 *
 * **The rule that matters and is not obvious:** window membership is tested
 * against the **booking** date, not the stay date. A booking prepaid in
 * December for a stay next June burns *this* window's credit. §7.5 calls this
 * "the highest-leverage move available and it is not obvious", and getting it
 * backwards would cost the user a $300 bucket a year. See DECISIONS.md D-062.
 */

export interface DateWindow {
  /** Inclusive, `YYYY-MM-DD`. */
  readonly start: string;
  /** Inclusive, `YYYY-MM-DD`. */
  readonly end: string;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface WindowOptions {
  /** Calendar year the window belongs to. */
  readonly year: number;
  /**
   * The user's cardmember anniversary, `YYYY-MM-DD`. Only `CARDMEMBER_YEAR`
   * buckets use it. When unset, §2.4's window is undeterminable, so the bucket
   * falls back to the calendar year and the UI flags it as an assumption with a
   * link to set the real date — DECISIONS.md D-063.
   */
  readonly anniversary?: string | null;
}

export function windowFor(
  kind: CreditWindowKind,
  options: WindowOptions,
  fixedWindowEnd?: string,
): DateWindow {
  const { year, anniversary } = options;

  switch (kind) {
    case 'CALENDAR_H1':
      return { start: iso(year, 1, 1), end: iso(year, 6, 30) };

    case 'CALENDAR_H2':
      return { start: iso(year, 7, 1), end: iso(year, 12, 31) };

    case 'FIXED':
      // A fixed window runs from the start of the seeding year to a hard date.
      return { start: iso(year, 1, 1), end: fixedWindowEnd ?? iso(year, 12, 31) };

    case 'CARDMEMBER_YEAR': {
      if (!anniversary) {
        // Fall back rather than guess a date. The UI surfaces this as an
        // explicit assumption, because silently picking one would produce a
        // confidently wrong expiry countdown.
        return { start: iso(year, 1, 1), end: iso(year, 12, 31) };
      }
      const parts = anniversary.split('-');
      const month = Number(parts[1] ?? '1');
      const day = Number(parts[2] ?? '1');
      const start = iso(year, month, day);
      // The day before the same date next year — a full cardmember year.
      const endDate = new Date(Date.UTC(year + 1, month - 1, day));
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      return {
        start,
        end: iso(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate()),
      };
    }

    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled credit window kind: ${String(exhaustive)}`);
    }
  }
}

export function windowForDefinition(
  definition: CreditBucketDefinition,
  options: WindowOptions,
): DateWindow {
  return windowFor(definition.windowKind, options, definition.fixedWindowEnd);
}

/** Whether a date falls inside the window. Both ends inclusive. */
export function windowContains(window: DateWindow, isoDate: string): boolean {
  return isoDate >= window.start && isoDate <= window.end;
}

/**
 * Whole days from `today` until the window closes. Negative once it has closed.
 *
 * Compared as UTC midnights rather than as instants, so a user in Tokyo and a
 * user in New York both see "3 days left" on the same calendar day rather than
 * one of them seeing 2.
 */
export function daysRemainingIn(window: DateWindow, today: string): number {
  const end = Date.parse(`${window.end}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((end - now) / 86_400_000);
}

/** `YYYY-MM-DD` for an instant, in a given IANA zone. */
export function toIsoDate(instant: Date, timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts;
}
