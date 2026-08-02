/**
 * Quiet hours — §9: "Honour … a global quiet-hours window. Respect it — a
 * 3 a.m. credit-expiry email is a product failure."
 *
 * §4.2's `user_settings` has no dedicated quiet-hours columns (and this task
 * is not permitted to add one — `schema.ts` is read-only), so this is the
 * literal reading of "**global** quiet-hours window": one fixed band, not a
 * per-user setting, applied against the one per-user fact the schema *does*
 * carry — `user_settings.timezone`. 21:00–08:00 local covers a normal sleep
 * window generously in both directions.
 */
export const QUIET_HOURS_START_HOUR = 21;
export const QUIET_HOURS_END_HOUR = 8;

export const DEFAULT_TIMEZONE = 'America/New_York';

/** The local hour (0–23) `now` falls on in `timezone`, falling back to UTC for an unrecognised zone. */
export function localHour(now: Date, timezone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(now);
    return Number(formatted);
  } catch {
    return now.getUTCHours();
  }
}

/** Whether `now` falls inside the quiet-hours band in the recipient's local time. */
export function isWithinQuietHours(now: Date, timezone: string): boolean {
  const hour = localHour(now, timezone);
  // The window wraps midnight — [21,24) ∪ [0,8) — so it is an "or", not a range.
  return hour >= QUIET_HOURS_START_HOUR || hour < QUIET_HOURS_END_HOUR;
}
