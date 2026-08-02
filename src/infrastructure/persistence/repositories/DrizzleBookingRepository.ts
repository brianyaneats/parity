import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { bookings } from '../schema';
import { cents } from '@/domain/shared/cents';
import type {
  BookingPatch,
  BookingRecord,
  BookingRepository,
  NewBookingInput,
} from '@/application/ports/BookingRepository';
import type { DrizzleHandle } from './drizzle-handle';

/**
 * Drizzle implementation of `BookingRepository` — §4.2.
 *
 * Accepts an optional `DrizzleHandle` so `DrizzleUnitOfWork` can hand it a
 * transaction (`tx`) instead of the module-level `db`, while route-local,
 * non-transactional callers (`GET`/`PATCH /api/bookings/:id`) can construct it
 * with no arguments and use the ordinary pooled client.
 */
export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly handle: DrizzleHandle = db) {}

  public async create(input: NewBookingInput): Promise<BookingRecord> {
    const [row] = await this.handle
      .insert(bookings)
      .values({
        id: input.id,
        userId: input.userId,
        comparisonId: input.comparisonId,
        channel: input.channel,
        confirmationNumber: input.confirmationNumber,
        bookedAt: input.bookedAt,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        totalCents: input.totalCents,
        baseCents: input.baseCents,
        cashChargedCents: input.cashChargedCents,
        pointsUsed: input.pointsUsed,
        refundable: input.refundable,
        cancelDeadline: input.cancelDeadline,
        bucketId: input.bucketId,
        status: input.status,
      })
      .returning();
    if (!row) throw new Error('Insert into bookings returned no row.');
    return toBookingRecord(row);
  }

  public async findById(id: string, userId: string): Promise<BookingRecord | null> {
    const [row] = await this.handle
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, id), eq(bookings.userId, userId)))
      .limit(1);
    return row ? toBookingRecord(row) : null;
  }

  public async update(id: string, userId: string, patch: BookingPatch): Promise<BookingRecord | null> {
    const [row] = await this.handle
      .update(bookings)
      .set({
        ...(patch.confirmationNumber !== undefined ? { confirmationNumber: patch.confirmationNumber } : {}),
        ...(patch.cashChargedCents !== undefined ? { cashChargedCents: patch.cashChargedCents } : {}),
        ...(patch.pointsUsed !== undefined ? { pointsUsed: patch.pointsUsed } : {}),
        ...(patch.bucketId !== undefined ? { bucketId: patch.bucketId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      })
      .where(and(eq(bookings.id, id), eq(bookings.userId, userId)))
      .returning();
    return row ? toBookingRecord(row) : null;
  }
}

interface BookingRowLike {
  readonly id: string;
  readonly userId: string;
  readonly comparisonId: string | null;
  readonly channel: BookingRecord['channel'];
  readonly confirmationNumber: string | null;
  readonly bookedAt: Date;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly totalCents: number;
  readonly baseCents: number;
  readonly cashChargedCents: number | null;
  readonly pointsUsed: number | null;
  readonly refundable: boolean;
  readonly cancelDeadline: string | null;
  readonly bucketId: string | null;
  readonly status: BookingRecord['status'];
  readonly createdAt: Date;
}

function toBookingRecord(row: BookingRowLike): BookingRecord {
  return {
    id: row.id,
    userId: row.userId,
    comparisonId: row.comparisonId,
    channel: row.channel,
    confirmationNumber: row.confirmationNumber,
    bookedAt: row.bookedAt,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    totalCents: cents(row.totalCents),
    baseCents: cents(row.baseCents),
    cashChargedCents: row.cashChargedCents !== null ? cents(row.cashChargedCents) : null,
    pointsUsed: row.pointsUsed,
    refundable: row.refundable,
    cancelDeadline: row.cancelDeadline,
    bucketId: row.bucketId,
    status: row.status,
    createdAt: row.createdAt,
  };
}
