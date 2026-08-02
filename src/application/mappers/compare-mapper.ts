import { cents, type Cents } from '@/domain/shared/cents';
import type { ChannelQuote, StayContext } from '@/domain/engine/types';
import type { CompareRequest } from '@/lib/validation/compare';

/**
 * The boundary where validated JSON becomes branded domain values.
 *
 * §3.1: "Percentages the user types: parse to bps at the boundary; never let a
 * float past the input layer." The same applies to money — Zod validates that a
 * field is an integer, and this is where that integer acquires the `Cents`
 * brand. Casting inline at each call site would work and would also mean nine
 * places to forget.
 */

export function toStayContext(input: CompareRequest['context']): StayContext {
  return {
    nights: input.nights,
    taxRateBps: input.taxRateBps,
    breakfastPerDayCents: cents(input.breakfastPerDayCents),
    propertyCreditFaceCents: cents(input.propertyCreditFaceCents),
    realizationPct: input.realizationPct,
    mrValueMicro: input.mrValueMicro,
    urValueMicro: input.urValueMicro,
    foraRateBps: input.foraRateBps,
    amexBucketAvailable: input.amexBucketAvailable,
    editBucketAvailable: input.editBucketAvailable,
    // §3.6: null is "add a competing rate to check", and must survive as null
    // rather than becoming a zero that would read as a free hotel room.
    competitorBaseCents:
      input.competitorBaseCents === null ? null : cents(input.competitorBaseCents),
    competitorRefundable: input.competitorRefundable,
    competitorPublic: input.competitorPublic,
    brand: input.brand,
  };
}

export function toChannelQuote(input: CompareRequest['quotes'][number]): ChannelQuote {
  return {
    channel: input.channel,
    totalCents: cents(input.totalCents),
    prepaid: input.prepaid,
    refundable: input.refundable,
    ...(input.label ? { label: input.label } : {}),
  };
}

export function toChannelQuotes(input: CompareRequest['quotes']): ChannelQuote[] {
  return input.map(toChannelQuote);
}

/**
 * Derives a tax rate in basis points from any two of base / tax / total — the
 * §7.3 helper for the common case where the user can read a base and a total
 * off a booking page but the rate itself is never displayed.
 *
 * Returns `null` when the inputs cannot determine a rate (a zero base would
 * divide by zero) rather than reporting a fabricated 0%.
 */
export function deriveTaxRateBps(input: {
  baseCents?: number | null;
  taxCents?: number | null;
  totalCents?: number | null;
}): number | null {
  const base = input.baseCents ?? null;
  const tax = input.taxCents ?? null;
  const total = input.totalCents ?? null;

  const resolvedBase: number | null = base ?? (total !== null && tax !== null ? total - tax : null);
  const resolvedTax: number | null = tax ?? (total !== null && base !== null ? total - base : null);

  if (resolvedBase === null || resolvedTax === null || resolvedBase <= 0) return null;

  return Math.round((resolvedTax / resolvedBase) * 10_000);
}

export type { Cents };
