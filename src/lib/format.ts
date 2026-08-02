/**
 * Display formatting — the render layer, and only the render layer.
 *
 * §3.1: "Currency display via `Intl.NumberFormat` at the render layer only."
 * Nothing in `src/domain/` imports this file; money stays integer cents right
 * up to the moment it becomes text.
 *
 * §6.3 also governs sign convention: "savings positive, costs neutral, never a
 * bare negative without context." `formatSaving` and `formatCost` exist so a
 * component picks the convention explicitly rather than each one inventing it.
 */

const currencyCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${currency}:${JSON.stringify(options)}`;
  let cached = currencyCache.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat('en-US', { style: 'currency', currency, ...options });
    currencyCache.set(key, cached);
  }
  return cached;
}

/** `239086` → `"$2,390.86"`. */
export function formatCents(value: number, currency = 'USD'): string {
  return formatter(currency, {}).format(value / 100);
}

/** `239086` → `"$2,391"`. For dense tables where cents are noise. */
export function formatCentsRounded(value: number, currency = 'USD'): string {
  return formatter(currency, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value / 100);
}

/**
 * A saving, always rendered as a positive figure with its meaning in the label
 * rather than in a minus sign. A saving of −$50 is a nonsense the user has to
 * decode; "you save $50" and "you lose $50" are two different labels.
 */
export function formatSaving(value: number, currency = 'USD'): string {
  return formatCents(Math.abs(value), currency);
}

/**
 * A delta against the winner. Explicitly signed, because here the sign *is* the
 * information: `+$328.14` means this channel costs that much more.
 */
export function formatDelta(value: number, currency = 'USD'): string {
  if (value === 0) return '—';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${formatCents(Math.abs(value), currency)}`;
}

/**
 * An effective net, which §3.6 says may legitimately be negative. A negative
 * net means the perks and credits exceeded the room cost, so it renders as a
 * credit rather than as a negative price.
 */
export function formatNet(value: number, currency = 'USD'): string {
  return value < 0 ? `${formatCents(Math.abs(value), currency)} back` : formatCents(value, currency);
}

/** `1240` → `"12.40%"`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** `17500` → `"1.75¢"`. The unit the user thinks in for point valuations. */
export function formatMicroCents(micro: number): string {
  return `${(micro / 10_000).toFixed(2)}¢`;
}

export function formatPoints(points: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(points);
}

export function formatNights(nights: number): string {
  return `${nights} night${nights === 1 ? '' : 's'}`;
}

export function formatDays(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * A countdown, for the §7.4 claim timer.
 *
 * Shows seconds under an hour and drops them above it: the difference between
 * 23h and 23h 14m 02s matters to nobody, but the difference between 4m and 3m
 * 58s is the whole point of the last hour. Never goes negative — an expired
 * claim reads "Expired", not "−00:04:12".
 */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return 'Expired';

  const totalSeconds = Math.floor(msRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The urgency band for a countdown — §7.4: green over 6h, amber 1–6h, red under
 * an hour, then expired. Returned as a token name so the component never picks
 * a colour, and so colour is never the sole carrier (§6.7 pairs it with a label).
 */
export type UrgencyBand = 'safe' | 'warning' | 'critical' | 'expired';

export function urgencyOf(msRemaining: number): UrgencyBand {
  if (msRemaining <= 0) return 'expired';
  // §7.4 reads "green > 6h, amber 1–6h, red < 1h". Both boundaries belong to
  // the more urgent band: exactly 6h is amber because it is not *greater* than
  // 6h, and exactly 1h is amber because the amber range is inclusive of 1h.
  if (msRemaining < 60 * 60 * 1000) return 'critical';
  if (msRemaining <= 6 * 60 * 60 * 1000) return 'warning';
  return 'safe';
}

/** Renders a date in the user's timezone — §7.4 requires the exact deadline shown. */
export function formatDateTime(value: Date | string, timeZone = 'America/New_York'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatDate(value: Date | string, timeZone = 'America/New_York'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(date);
}
