import { Booking, type BookingProps } from '@/domain/booking/Booking';
import { CHANNEL_DEFINITIONS } from '@/domain/rules/channels.rules';
import { cents } from '@/domain/shared/cents';
import type { BookingRecord, NewBookingInput } from '@/application/ports/BookingRepository';

/**
 * The boundary between the `Booking` aggregate and its persisted row.
 *
 * **A disclosed schema gap.** `BookingProps.prepaid` drives
 * `Booking.opensPriceMatchClaim` (§5.2's auto-claim rule), but neither §4.2's
 * `bookings` DDL nor `schema.ts` (both out of scope to change for this task)
 * has a `prepaid` column — only `refundable` is persisted. That is harmless
 * for the one rule that reads `prepaid`: it is evaluated once, inside
 * `Booking.record()`, from the value the caller supplies at creation time
 * (`RecordBookingUseCase` passes the validated request's own `prepaid` field
 * straight through), and no other `Booking` method reads it afterwards. So on
 * **rehydration** (`toBookingProps`, used only by flows that load an existing
 * booking to call a *different* method — `recordPaymentSplit`,
 * `assignBucket`, `transitionTo`, …) there is nothing durable to read back,
 * and reconstructing it exactly does not matter functionally. Rather than
 * invent an inert `true`/`false`, this falls back to
 * `CHANNEL_DEFINITIONS[channel].typicallyPrepaid` — a field `channels.rules.ts`
 * already documents as "advisory only" for exactly this kind of situation.
 */
export function toBookingProps(record: BookingRecord): BookingProps {
  return {
    id: record.id,
    userId: record.userId,
    comparisonId: record.comparisonId,
    channel: record.channel,
    confirmationNumber: record.confirmationNumber,
    bookedAt: record.bookedAt,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    totalCents: record.totalCents,
    baseCents: record.baseCents,
    cashChargedCents: record.cashChargedCents,
    pointsUsed: record.pointsUsed,
    prepaid: CHANNEL_DEFINITIONS[record.channel].typicallyPrepaid,
    refundable: record.refundable,
    cancelDeadline: record.cancelDeadline,
    bucketId: record.bucketId,
    status: record.status,
  };
}

/** Builds the persistence input from a freshly-recorded (not-yet-saved) `Booking`. */
export function toNewBookingInput(booking: Booking): NewBookingInput {
  return {
    id: booking.id,
    userId: booking.userId,
    comparisonId: booking.comparisonId,
    channel: booking.channel,
    confirmationNumber: booking.confirmationNumber,
    bookedAt: booking.bookedAt,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    totalCents: cents(booking.totalCents),
    baseCents: cents(booking.baseCents),
    cashChargedCents: booking.cashChargedCents !== null ? cents(booking.cashChargedCents) : null,
    pointsUsed: booking.pointsUsed,
    refundable: booking.refundable,
    cancelDeadline: booking.cancelDeadline,
    bucketId: booking.bucketId,
    status: booking.status,
  };
}
