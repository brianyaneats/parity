/**
 * Clock port — §3 forbids `Date.now()` inside pure functions, and §10.2 forbids
 * mocking time in a way that hides a timezone bug.
 *
 * The 24-hour price-match window is the highest-stakes time math in the app
 * (§13.3), so time is a dependency that gets injected and tested, never an
 * ambient global that gets stubbed.
 */
export interface Clock {
  now(): Date;
}

/** Production clock. The only place `new Date()` is allowed to appear. */
export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

/**
 * Test clock. Advanceable rather than frozen, so a countdown can be driven
 * across a real boundary — DST, UTC midnight — instead of being pinned.
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string | number) {
    this.current = new Date(start);
    if (Number.isNaN(this.current.getTime())) {
      throw new RangeError(`FixedClock requires a valid instant, received: ${String(start)}`);
    }
  }

  public now(): Date {
    return new Date(this.current);
  }

  public advanceMs(ms: number): this {
    this.current = new Date(this.current.getTime() + ms);
    return this;
  }

  public advanceHours(hours: number): this {
    return this.advanceMs(hours * 60 * 60 * 1000);
  }

  public advanceDays(days: number): this {
    return this.advanceHours(days * 24);
  }

  public set(instant: Date | string | number): this {
    this.current = new Date(instant);
    return this;
  }
}

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Adds hours as an absolute duration.
 *
 * Deliberately arithmetic on the epoch millisecond value rather than calendar
 * field manipulation: the claim deadline is "24 hours after booking" as a
 * physical duration, and it must not gain or lose an hour when a DST boundary
 * falls inside the window. §10.2 requires a test that crosses one.
 */
export function addHours(instant: Date, hours: number): Date {
  return new Date(instant.getTime() + hours * MS_PER_HOUR);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * MS_PER_DAY);
}

/** Whole days between two instants, truncated toward zero. */
export function daysBetween(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Milliseconds remaining until `deadline`, floored at zero. */
export function msUntil(now: Date, deadline: Date): number {
  return Math.max(0, deadline.getTime() - now.getTime());
}
