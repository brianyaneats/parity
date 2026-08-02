import { describe, it, expect } from 'vitest';
import { isWithinQuietHours, localHour, QUIET_HOURS_START_HOUR, QUIET_HOURS_END_HOUR } from './quiet-hours';

/**
 * §9: "a 3 a.m. credit-expiry email is a product failure." The band wraps
 * midnight (21:00–08:00), so both boundaries and the wrap itself need direct
 * coverage, not just one 3 a.m. sample.
 */
describe('quiet-hours — §9', () => {
  it('flags 3 a.m. America/New_York as quiet', () => {
    // 07:00 UTC in July is 03:00 EDT.
    expect(isWithinQuietHours(new Date('2026-07-27T07:00:00Z'), 'America/New_York')).toBe(true);
  });

  it('does not flag mid-morning', () => {
    // 15:00 UTC in July is 11:00 EDT.
    expect(isWithinQuietHours(new Date('2026-07-27T15:00:00Z'), 'America/New_York')).toBe(false);
  });

  it('start boundary (21:00) is inclusive — quiet', () => {
    expect(localHour(new Date('2026-01-01T21:00:00Z'), 'UTC')).toBe(QUIET_HOURS_START_HOUR);
    expect(isWithinQuietHours(new Date('2026-01-01T21:00:00Z'), 'UTC')).toBe(true);
  });

  it('just before the start boundary (20:59) is not quiet', () => {
    expect(isWithinQuietHours(new Date('2026-01-01T20:59:00Z'), 'UTC')).toBe(false);
  });

  it('end boundary (08:00) is exclusive — no longer quiet', () => {
    expect(localHour(new Date('2026-01-01T08:00:00Z'), 'UTC')).toBe(QUIET_HOURS_END_HOUR);
    expect(isWithinQuietHours(new Date('2026-01-01T08:00:00Z'), 'UTC')).toBe(false);
  });

  it('just before the end boundary (07:59) is still quiet', () => {
    expect(isWithinQuietHours(new Date('2026-01-01T07:59:00Z'), 'UTC')).toBe(true);
  });

  it('is quiet through UTC midnight — the window wraps, not clamps', () => {
    expect(isWithinQuietHours(new Date('2026-01-01T23:30:00Z'), 'UTC')).toBe(true);
    expect(isWithinQuietHours(new Date('2026-01-02T00:30:00Z'), 'UTC')).toBe(true);
  });

  it('falls back to UTC for an unrecognised timezone rather than throwing', () => {
    expect(() => localHour(new Date(), 'Not/AZone')).not.toThrow();
  });

  it('two users in different zones can disagree on quiet hours at the same instant', () => {
    const instant = new Date('2026-07-27T12:00:00Z'); // noon UTC
    // Noon UTC is 08:00 in New York (EDT) and 21:00 in Tokyo (JST, UTC+9).
    expect(isWithinQuietHours(instant, 'America/New_York')).toBe(false);
    expect(isWithinQuietHours(instant, 'Asia/Tokyo')).toBe(true);
  });
});
