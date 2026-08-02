import { describe, it, expect } from 'vitest';
import { createBookingSchema, bookingPatchSchema } from './bookings';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'EDIT',
    bookedAt: '2026-07-27T12:00:00.000Z',
    checkIn: '2026-08-01',
    checkOut: '2026-08-04',
    totalCents: 354000,
    baseCents: 314947,
    prepaid: true,
    refundable: true,
    ...overrides,
  };
}

describe('createBookingSchema — §5.2 POST /api/bookings', () => {
  it('accepts a well-formed payload with only the required fields', () => {
    expect(createBookingSchema.safeParse(validPayload()).success).toBe(true);
  });

  it('requires `prepaid` — it is what decides the auto-claim rule', () => {
    const { prepaid, ...withoutPrepaid } = validPayload();
    expect(createBookingSchema.safeParse(withoutPrepaid).success).toBe(false);
  });

  it('rejects an invalid bookedAt', () => {
    expect(createBookingSchema.safeParse(validPayload({ bookedAt: 'not-a-date' })).success).toBe(false);
  });

  it('rejects a negative total', () => {
    expect(createBookingSchema.safeParse(validPayload({ totalCents: -1 })).success).toBe(false);
  });

  it('accepts a null comparisonId — a booking need not come from a saved comparison', () => {
    expect(createBookingSchema.safeParse(validPayload({ comparisonId: null })).success).toBe(true);
  });

  it('rejects an unknown channel', () => {
    expect(createBookingSchema.safeParse(validPayload({ channel: 'MYSTERY' })).success).toBe(false);
  });
});

describe('bookingPatchSchema — §5.2 PATCH /api/bookings/:id', () => {
  it('accepts a status-only patch', () => {
    expect(bookingPatchSchema.safeParse({ status: 'CANCELLED' }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(bookingPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(bookingPatchSchema.safeParse({ status: 'REFUNDED' }).success).toBe(false);
  });
});
