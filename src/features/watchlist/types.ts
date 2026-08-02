import type { Channel } from '@/domain/rules/channels.rules';
import type { BookingStatus } from '@/domain/booking/Booking';

/**
 * Plain, RSC-serialisable join of one `bookings` row with its `watchlist`
 * row and the property name it books (denormalised here the same way
 * `comparisons.property_name_snapshot` denormalises it in §4.2 — a booking
 * should keep displaying its property name even if the property row is later
 * edited or deleted).
 *
 * `WatchlistScreen` rehydrates the real `Booking` aggregate from rows shaped
 * like this — see `CreditWallet`'s equivalent doc comment on `BucketRow` for
 * why a class instance cannot be the prop type crossing the server/client
 * boundary.
 */
export interface WatchlistBookingRow {
  readonly id: string;
  readonly userId: string;
  readonly comparisonId: string | null;
  readonly propertyName: string;
  readonly channel: Channel;
  readonly confirmationNumber: string | null;
  /** ISO instant. */
  readonly bookedAt: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly totalCents: number;
  readonly baseCents: number;
  readonly cashChargedCents: number | null;
  readonly pointsUsed: number | null;
  readonly prepaid: boolean;
  readonly refundable: boolean;
  readonly cancelDeadline: string | null;
  readonly bucketId: string | null;
  readonly status: BookingStatus;

  readonly watchlistId: string;
  readonly cadenceDays: number;
  /** ISO instant, or null if never checked. */
  readonly lastCheckedAt: string | null;
  /** ISO instant. */
  readonly nextCheckAt: string;
  readonly active: boolean;

  /**
   * The lowest total a re-shop check has found since booking, if any. No
   * background `watchlist-reshop` job (§9) exists yet to populate this — it
   * is modelled here so the row and its §7.6 rebook prompt are ready for one.
   */
  readonly cheaperOptionCents?: number | null;
}
