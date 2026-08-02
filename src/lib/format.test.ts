import { describe, it, expect } from 'vitest';
import {
  formatCents,
  formatCentsRounded,
  formatSaving,
  formatDelta,
  formatNet,
  formatBps,
  formatMicroCents,
  formatPoints,
  formatNights,
  formatDays,
  formatCountdown,
  urgencyOf,
  formatDateTime,
  formatDate,
} from './format';

/**
 * §3.1 confines currency formatting to the render layer, and §6.3 sets the sign
 * convention: "savings positive, costs neutral, never a bare negative without
 * context." These functions are where both rules are actually enforced.
 */

describe('money formatting', () => {
  it('renders cents as dollars with grouping', () => {
    expect(formatCents(239_086)).toBe('$2,390.86');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(7)).toBe('$0.07');
  });

  it('drops the cents for dense tables', () => {
    expect(formatCentsRounded(239_086)).toBe('$2,391');
    expect(formatCentsRounded(-5_991)).toBe('-$60');
  });

  it('respects a non-USD currency', () => {
    expect(formatCents(120_000, 'JPY')).toContain('¥');
    expect(formatCents(123_450, 'GBP')).toBe('£1,234.50');
  });
});

describe('formatSaving — §6.3 sign convention', () => {
  it('always renders a positive figure, leaving the meaning to the label', () => {
    // "you save −$50" is a nonsense the user has to decode; the label says
    // whether it is a saving or a loss.
    expect(formatSaving(32_914)).toBe('$329.14');
    expect(formatSaving(-32_914)).toBe('$329.14');
  });
});

describe('formatDelta — where the sign IS the information', () => {
  it('signs a delta explicitly', () => {
    expect(formatDelta(32_914)).toBe('+$329.14');
    expect(formatDelta(-32_914)).toBe('−$329.14');
  });

  it('renders a zero delta as a dash rather than "+$0.00"', () => {
    expect(formatDelta(0)).toBe('—');
  });

  it('uses a true minus sign, not a hyphen', () => {
    expect(formatDelta(-100)).toContain('−');
    expect(formatDelta(-100)).not.toContain('-$');
  });
});

describe('formatNet — §3.6, a negative net is legal', () => {
  it('renders a positive net as a price', () => {
    expect(formatNet(239_086)).toBe('$2,390.86');
  });

  it('renders a negative net as money back, not as a negative price', () => {
    // TC-05 nets −$240.00: perks, credit and refund exceeded the room cost.
    expect(formatNet(-24_000)).toBe('$240.00 back');
  });

  it('renders zero as zero', () => {
    expect(formatNet(0)).toBe('$0.00');
  });
});

describe('rate formatting', () => {
  it('renders basis points as a percentage', () => {
    expect(formatBps(1240)).toBe('12.40%');
    expect(formatBps(0)).toBe('0.00%');
    expect(formatBps(700)).toBe('7.00%');
  });

  it('renders micro-cents as cents per point', () => {
    expect(formatMicroCents(17_500)).toBe('1.75¢');
    expect(formatMicroCents(15_000)).toBe('1.50¢');
    // TC-09's break-even.
    expect(formatMicroCents(4_400)).toBe('0.44¢');
  });

  it('groups point counts', () => {
    expect(formatPoints(25_124)).toBe('25,124');
    expect(formatPoints(0)).toBe('0');
  });
});

describe('pluralisation', () => {
  it('pluralises nights and days correctly', () => {
    expect(formatNights(1)).toBe('1 night');
    expect(formatNights(3)).toBe('3 nights');
    expect(formatNights(0)).toBe('0 nights');
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(30)).toBe('30 days');
  });
});

/**
 * §7.4's countdown. The design decision worth testing: seconds appear only
 * under an hour. The difference between 23h and 23h 14m 02s matters to nobody;
 * the difference between 4m and 3m 58s is the whole point of the last hour.
 */
describe('formatCountdown', () => {
  const HOUR = 3_600_000;

  it('shows hours and minutes above an hour, and no seconds', () => {
    expect(formatCountdown(23 * HOUR + 14 * 60_000 + 2_000)).toBe('23h 14m');
    expect(formatCountdown(HOUR)).toBe('1h 00m');
  });

  it('shows minutes and seconds under an hour', () => {
    expect(formatCountdown(HOUR - 1)).toBe('59:59');
    expect(formatCountdown(4 * 60_000)).toBe('04:00');
    expect(formatCountdown(3 * 60_000 + 58_000)).toBe('03:58');
    expect(formatCountdown(1_000)).toBe('00:01');
  });

  it('never renders a negative countdown', () => {
    expect(formatCountdown(0)).toBe('Expired');
    expect(formatCountdown(-1)).toBe('Expired');
    expect(formatCountdown(-999_999)).toBe('Expired');
  });
});

describe('urgencyOf — §7.4 bands', () => {
  const HOUR = 3_600_000;

  it('bands by time remaining, with each boundary belonging to the more urgent band', () => {
    // §7.4: "green > 6h, amber 1–6h, red < 1h". Exactly 6h is amber because it
    // is not *greater* than 6h; exactly 1h is amber because the amber range is
    // inclusive of 1h. Both readings favour urgency, which is the right bias
    // for a deadline the user cannot recover from missing.
    expect(urgencyOf(24 * HOUR)).toBe('safe');
    expect(urgencyOf(6 * HOUR + 1)).toBe('safe');
    expect(urgencyOf(6 * HOUR)).toBe('warning');
    expect(urgencyOf(HOUR + 1)).toBe('warning');
    expect(urgencyOf(HOUR)).toBe('warning');
    expect(urgencyOf(HOUR - 1)).toBe('critical');
    expect(urgencyOf(1)).toBe('critical');
    expect(urgencyOf(0)).toBe('expired');
    expect(urgencyOf(-1)).toBe('expired');
  });

  it('returns a band name, never a colour, so components cannot skip the label', () => {
    // §6.7: colour is never the sole carrier of meaning.
    expect(['safe', 'warning', 'critical', 'expired']).toContain(urgencyOf(HOUR));
  });
});

describe('date formatting', () => {
  it('renders a date in the requested zone', () => {
    // 03:00 UTC on the 28th is still the 27th in New York. A claim deadline
    // shown in the wrong day is worse than showing no deadline at all.
    const instant = new Date('2026-07-28T03:00:00Z');
    expect(formatDate(instant, 'UTC')).toBe('Jul 28, 2026');
    expect(formatDate(instant, 'America/New_York')).toBe('Jul 27, 2026');
  });

  it('renders a timestamp with both date and time', () => {
    const rendered = formatDateTime('2026-07-28T12:00:00Z', 'UTC');
    expect(rendered).toContain('Jul 28, 2026');
    expect(rendered).toContain('12:00');
  });

  it('accepts a string or a Date', () => {
    expect(formatDate('2026-09-01T00:00:00Z', 'UTC')).toBe(
      formatDate(new Date('2026-09-01T00:00:00Z'), 'UTC'),
    );
  });
});
