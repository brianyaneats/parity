import { InvariantViolationError } from '../shared/DomainError';
import { cents, subtractCents, type Cents } from '../shared/cents';

/**
 * The generated claim text — §7.4 item 4, §8.2.
 *
 * A pure function: no I/O, no React, no `Date.now()`. Its only job is to turn
 * already-known figures into the text a reviewer reads, so it must "state
 * every matching parameter explicitly … so a reviewer never has to infer."
 * That list, verbatim from the task brief, is exactly PM8's match parameters
 * (hotel name, address, both dates, room type, bed type, guest count,
 * currency, cancellation policy) plus the price comparison itself (base rate
 * per night and in total, for both the booking and the competing rate).
 *
 * §12 bans promising a refund ("never state a refund as guaranteed"); this
 * function must never emit the word "guarantee" or "guaranteed" — see the
 * matching test in `claim-packet.test.ts`.
 *
 * Money formatting is injected (`formatMoney`) rather than imported from
 * `src/lib/format.ts` directly. `src/lib/format.ts`'s own doc comment states
 * the house rule plainly: "Nothing in `src/domain/` imports this file; money
 * stays integer cents right up to the moment it becomes text." This module's
 * whole job *is* that moment, which makes it tempting to import `formatCents`
 * directly — but doing so would make a domain module depend on the
 * presentation layer, which is exactly what that rule exists to prevent.
 * Accepting the formatter as a parameter keeps this function pure and
 * dependency-free while still reusing the one canonical formatter: the
 * caller (`src/features/claims/ClaimKit.tsx`) passes `formatCents` in, so the
 * money text is byte-for-byte what the rest of the app prints, without this
 * module importing render-layer code. This is a resolved ambiguity — the
 * task brief lists `formatCents` under "REUSE, write no new formatters" but
 * doesn't say how a domain-layer module should reuse a render-layer function;
 * dependency injection is the resolution.
 */

export interface ClaimPacketInput {
  readonly hotelName: string;
  readonly hotelAddress: string;
  /** ISO `YYYY-MM-DD`. */
  readonly checkIn: string;
  /** ISO `YYYY-MM-DD`. */
  readonly checkOut: string;
  readonly roomType: string;
  readonly bedType: string;
  readonly guestCount: number;
  /** ISO 4217, e.g. `'USD'`. */
  readonly currency: string;
  readonly cancellationPolicy: string;
  readonly nights: number;

  readonly bookingChannelLabel: string;
  readonly ownTotalCents: Cents;
  readonly ownBaseCents: Cents;

  readonly competitorSiteDomain: string;
  readonly competitorUrl: string;
  readonly competitorBaseCents: Cents;
  /** `null` when the competing-rate capture recorded no tax breakdown. */
  readonly competitorTotalCents: Cents | null;

  /** Injected formatter — see the module doc above for why. */
  readonly formatMoney: (value: Cents) => string;
}

/**
 * Generates the claim text, ready to paste into an issuer's claim form.
 *
 * Every §7.4-listed matching parameter is stated on its own line so a
 * reviewer reading the text has nothing to infer. The base rate is stated
 * both per night and in total for the booking and for the competing rate,
 * per the task brief, and the nightly gap that PM7 actually gates is spelled
 * out explicitly rather than left for the reviewer to compute.
 */
export function generateClaimPacket(input: ClaimPacketInput): string {
  if (input.nights < 1) {
    throw new InvariantViolationError('A claim packet needs at least one night to state a per-night rate.', {
      nights: input.nights,
    });
  }

  const ownPerNightCents = cents(input.ownBaseCents / input.nights);
  const competitorPerNightCents = cents(input.competitorBaseCents / input.nights);
  const gapTotalCents = subtractCents(input.ownBaseCents, input.competitorBaseCents);
  const gapPerNightCents = subtractCents(ownPerNightCents, competitorPerNightCents);
  const { formatMoney } = input;

  const lines: string[] = [
    `Price-match request — ${input.hotelName}`,
    '',
    'Booking details',
    `Hotel: ${input.hotelName}`,
    `Address: ${input.hotelAddress}`,
    `Dates: ${input.checkIn} to ${input.checkOut} (${input.nights} night${input.nights === 1 ? '' : 's'})`,
    `Room type: ${input.roomType}`,
    `Bed type: ${input.bedType}`,
    `Guests: ${input.guestCount}`,
    `Currency: ${input.currency}`,
    `Cancellation policy: ${input.cancellationPolicy}`,
    `Booked through: ${input.bookingChannelLabel}`,
    `My base rate: ${formatMoney(input.ownBaseCents)} total, ${formatMoney(ownPerNightCents)} per night`,
    `My total charged, including tax: ${formatMoney(input.ownTotalCents)}`,
    '',
    'Competing rate',
    `Source: ${input.competitorSiteDomain} (${input.competitorUrl})`,
    `Base rate: ${formatMoney(input.competitorBaseCents)} total, ${formatMoney(competitorPerNightCents)} per night`,
    input.competitorTotalCents !== null
      ? `Total, including tax: ${formatMoney(input.competitorTotalCents)}`
      : 'Total, including tax: not captured separately',
    '',
    'Basis for the claim',
    `Base-rate gap: ${formatMoney(gapTotalCents)} total, ${formatMoney(gapPerNightCents)} per night.`,
    `The competing rate matches this booking exactly on hotel, address, dates, room type, bed type, guest count, currency and cancellation policy, and was publicly available with no membership, loyalty, corporate, government, military, group, package, or promotional restriction.`,
    `I am requesting that the base-rate difference be credited to the original form of payment for this booking.`,
  ];

  return lines.join('\n');
}
