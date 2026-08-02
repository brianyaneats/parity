import type { Channel } from '@/domain/rules/channels.rules';
import type { BookingStatus, ComparisonStatus } from '@/infrastructure/persistence/schema';

/**
 * Trips view types — §7.8: "trips group comparisons and bookings; trip
 * detail shows a per-trip savings roll-up."
 *
 * Owned here, imported by the persistence query layer — the same split as
 * `PropertyOption` (owned by `CompareScreen.tsx`) and `LedgerEventView`
 * (owned by `ledger-types.ts`).
 */

export interface TripListItemView {
  readonly id: string;
  readonly name: string;
  readonly destination: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly archived: boolean;
  readonly comparisonCount: number;
  readonly bookingCount: number;
  /** Realized only — §8.6's headline rule applies here too: a trip's
   * one-line savings figure is never a projected/realized blend. */
  readonly realizedSavingsCents: number;
}

export interface TripComparisonView {
  readonly id: string;
  readonly propertyLabel: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly status: ComparisonStatus;
  readonly chosenChannel: Channel | null;
}

export interface TripBookingView {
  readonly id: string;
  readonly channel: Channel;
  /** ISO datetime. */
  readonly bookedAt: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly totalCents: number;
  readonly status: BookingStatus;
  readonly cancelDeadline: string | null;
  readonly refundable: boolean;
}

export interface TripDetailView {
  readonly id: string;
  readonly name: string;
  readonly destination: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly archived: boolean;
  readonly comparisons: readonly TripComparisonView[];
  readonly bookings: readonly TripBookingView[];
  readonly realizedSavingsCents: number;
  readonly projectedSavingsCents: number;
}
