import { describe, it, expect } from 'vitest';
import { generateClaimPacket, type ClaimPacketInput } from './claim-packet';
import type { Cents } from '../shared/cents';

const CENTS = (n: number) => n as Cents;

/** A trivial stand-in for `formatCents` — the packet is formatter-agnostic
 * (it accepts one via injection, see the module doc), so the test does not
 * need the real render-layer formatter to prove the text is assembled
 * correctly. Each fixture below still asserts the *values* it produces are
 * present, using this same formatter, so a bug in per-night arithmetic would
 * still be caught. */
const formatMoney = (value: Cents): string => `$${(value / 100).toFixed(2)}`;

function baseInput(overrides: Partial<ClaimPacketInput> = {}): ClaimPacketInput {
  return {
    hotelName: 'Four Seasons Otemachi',
    hotelAddress: '1-2-1 Otemachi, Chiyoda City, Tokyo 100-0004, Japan',
    checkIn: '2026-09-14',
    checkOut: '2026-09-17',
    roomType: 'Deluxe King',
    bedType: 'King',
    guestCount: 2,
    currency: 'USD',
    cancellationPolicy: 'Fully refundable until 3 days before check-in',
    nights: 3,
    bookingChannelLabel: 'Chase The Edit',
    ownTotalCents: CENTS(354_000),
    ownBaseCents: CENTS(314_947),
    competitorSiteDomain: 'fourseasons.com',
    competitorUrl: 'https://www.fourseasons.com/otemachi/rooms-suites/',
    competitorBaseCents: CENTS(300_000),
    competitorTotalCents: CENTS(336_000),
    formatMoney,
    ...overrides,
  };
}

describe('generateClaimPacket — §7.4 item 4, §8.2', () => {
  it('states every matching parameter explicitly, so a reviewer never has to infer', () => {
    const input = baseInput();
    const text = generateClaimPacket(input);

    // Hotel name, address, both dates.
    expect(text).toContain(input.hotelName);
    expect(text).toContain(input.hotelAddress);
    expect(text).toContain(input.checkIn);
    expect(text).toContain(input.checkOut);

    // Room type, bed type, guest count, currency, cancellation policy.
    expect(text).toContain(input.roomType);
    expect(text).toContain(input.bedType);
    expect(text).toContain(String(input.guestCount));
    expect(text).toContain(input.currency);
    expect(text).toContain(input.cancellationPolicy);

    // Base rate per night and in total — for both sides of the comparison.
    expect(text).toContain(formatMoney(input.ownBaseCents)); // own total
    expect(text).toContain(formatMoney(CENTS(input.ownBaseCents / input.nights))); // own per night
    expect(text).toContain(formatMoney(input.competitorBaseCents)); // competitor total
    expect(text).toContain(formatMoney(CENTS(input.competitorBaseCents / input.nights))); // competitor per night

    // The channel it was booked through, and the total actually charged.
    expect(text).toContain(input.bookingChannelLabel);
    expect(text).toContain(formatMoney(input.ownTotalCents));
  });

  it('never contains "guarantee" or "guaranteed" — §12 bans promising a refund', () => {
    const text = generateClaimPacket(baseInput());
    expect(text.toLowerCase()).not.toContain('guarantee');
    expect(text.toLowerCase()).not.toContain('guaranteed');
  });

  it('still omits "guarantee" when the competitor has no separate tax total captured', () => {
    const text = generateClaimPacket(baseInput({ competitorTotalCents: null }));
    expect(text.toLowerCase()).not.toContain('guarantee');
    expect(text).toContain('not captured separately');
  });

  it('computes the base-rate gap, total and per night, from the two base rates', () => {
    const input = baseInput();
    const text = generateClaimPacket(input);
    const gapTotal = (input.ownBaseCents - input.competitorBaseCents) as Cents;
    const gapPerNight = CENTS(
      Math.round(input.ownBaseCents / input.nights) - Math.round(input.competitorBaseCents / input.nights),
    );
    expect(text).toContain(formatMoney(gapTotal));
    expect(text).toContain(formatMoney(gapPerNight));
  });

  it('renders the competitor total when one was captured', () => {
    const text = generateClaimPacket(baseInput());
    expect(text).toContain(formatMoney(CENTS(336_000)));
    expect(text).not.toContain('not captured separately');
  });

  it('pluralizes "night" correctly for a single-night stay', () => {
    const text = generateClaimPacket(baseInput({ nights: 1, ownBaseCents: CENTS(100_000), competitorBaseCents: CENTS(90_000) }));
    expect(text).toContain('(1 night)');
    expect(text).not.toContain('(1 nights)');
  });

  it('rejects a non-positive night count rather than dividing by zero', () => {
    expect(() => generateClaimPacket(baseInput({ nights: 0 }))).toThrow(/at least one night/);
  });

  it('is a pure function: the same input always produces the same text', () => {
    const input = baseInput();
    expect(generateClaimPacket(input)).toBe(generateClaimPacket(input));
  });
});
