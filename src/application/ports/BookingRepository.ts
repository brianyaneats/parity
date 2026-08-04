import type { Channel } from '@/domain/rules/channels.rules';
import type { Cents } from '@/domain/shared/cents';
import type { BookingStatus } from '@/domain/booking/Booking';
import type { PaymentRoute } from '@/domain/rules/posting.rules';

export type { BookingStatus };

export interface BookingRecord {
  readonly id: string;
  readonly userId: string;
  readonly comparisonId: string | null;
  readonly channel: Channel;
  readonly confirmationNumber: string | null;
  readonly bookedAt: Date;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly totalCents: Cents;
  readonly baseCents: Cents;
  readonly cashChargedCents: Cents | null;
  readonly pointsUsed: number | null;
  readonly refundable: boolean;
  readonly cancelDeadline: string | null;
  readonly bucketId: string | null;
  readonly status: BookingStatus;
  /** Who processed the charge — decides whether a portal credit can post. */
  readonly paymentRoute: PaymentRoute | null;
  readonly createdAt: Date;
}

export interface NewBookingInput {
  readonly id: string;
  readonly userId: string;
  readonly comparisonId: string | null;
  readonly channel: Channel;
  readonly confirmationNumber: string | null;
  readonly bookedAt: Date;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly totalCents: Cents;
  readonly baseCents: Cents;
  readonly cashChargedCents: Cents | null;
  readonly pointsUsed: number | null;
  readonly refundable: boolean;
  readonly cancelDeadline: string | null;
  readonly bucketId: string | null;
  readonly status: BookingStatus;
  /** Who processed the charge — decides whether a portal credit can post. */
  /**
   * Who processed the charge — decides whether a portal credit can post.
   * Optional because it is genuinely unknown for bookings recorded before this
   * existed and for users who decline to say; guessing would fabricate the one
   * fact the credit-posting check depends on.
   */
  readonly paymentRoute?: PaymentRoute | null;
}

export interface BookingPatch {
  readonly confirmationNumber?: string | null;
  readonly cashChargedCents?: Cents | null;
  readonly pointsUsed?: number | null;
  readonly bucketId?: string | null;
  readonly status?: BookingStatus;
}

/**
 * `BookingRepository` — port over `bookings` (§4.2).
 *
 * `create` is deliberately the write side of `Booking.record()`, not a
 * replacement for it: the use case builds the aggregate first (so
 * `booking.recorded` is raised with the correctly-derived `opensClaim` /
 * `claimKind`), then persists the already-decided state through here. See
 * `RecordBookingUseCase`.
 */
export interface BookingRepository {
  create(input: NewBookingInput): Promise<BookingRecord>;
  findById(id: string, userId: string): Promise<BookingRecord | null>;
  update(id: string, userId: string, patch: BookingPatch): Promise<BookingRecord | null>;
}
