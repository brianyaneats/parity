/**
 * Money primitives — §3.1.
 *
 * All money in this product is integer cents. Never a float, never a `number`
 * holding dollars. The brand makes an accidental dollars-valued number a compile
 * error rather than a silently wrong invoice.
 */

export type Cents = number & { readonly __brand: 'Cents' };

/**
 * Basis points. `1240` means 12.40%. Used for tax rates, the Fora commission
 * split, and any percentage that must survive integer arithmetic.
 */
export type Bps = number & { readonly __brand: 'Bps' };

/**
 * Micro-cents per point. `17500` means 1.75 cents per point.
 *
 * Point valuations are the most contestable assumption in the whole model
 * (§2.5), so they are carried at four extra digits of precision to keep the
 * sensitivity analysis in §8.7 meaningful near a break-even.
 */
export type Micro = number & { readonly __brand: 'Micro' };

/** Denominator for converting basis points to a multiplier. */
export const BPS_SCALE = 10_000;

/** Denominator for `cents × multiplier × micro` → cents. */
export const MICRO_PER_CENT = 10_000;

/**
 * Rounds half away from zero — §3.1.
 *
 * This is deliberately not `Math.round`, which rounds half *up* and therefore
 * treats negatives asymmetrically (`Math.round(-0.5) === -0`). Gaps go negative
 * whenever the user's own rate already beats the market, so the asymmetry is
 * reachable in normal use, not a theoretical concern. See DECISIONS.md D-010.
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round a non-finite value: ${value}`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Constructs `Cents` from a number, rounding half away from zero. */
export const cents = (n: number): Cents => roundHalfAwayFromZero(n) as Cents;

/** Constructs `Bps` from a number. */
export const bps = (n: number): Bps => roundHalfAwayFromZero(n) as Bps;

/** Constructs `Micro` from a number. */
export const micro = (n: number): Micro => roundHalfAwayFromZero(n) as Micro;

/** The additive identity, typed. */
export const ZERO_CENTS: Cents = 0 as Cents;

/** Sums cents without leaving the branded type. */
export function sumCents(...values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) total += value;
  return total as Cents;
}

/** Subtracts `b` from `a`, staying in cents. Result may be negative — §3.6. */
export function subtractCents(a: Cents, b: Cents): Cents {
  return (a - b) as Cents;
}

/**
 * Applies a basis-point rate to a cents amount: `amount × bps / 10000`.
 * Single rounding site, so the result never depends on evaluation order.
 */
export function applyBps(amount: Cents, rate: number): Cents {
  return cents((amount * rate) / BPS_SCALE);
}

/**
 * Removes an inclusive basis-point tax from a gross amount — step 1 of §3.3.
 * `base = total / (1 + rate/10000)`.
 */
export function stripInclusiveBps(gross: Cents, rate: number): Cents {
  return cents(gross / (1 + rate / BPS_SCALE));
}

/**
 * Adds an inclusive basis-point tax back onto a base amount. Used by the BRG
 * path (§3.5) to convert a matched base rate into an all-in total.
 */
export function addInclusiveBps(base: Cents, rate: number): Cents {
  return cents(base * (1 + rate / BPS_SCALE));
}

/**
 * Values earned points, as one fused integer expression — DECISIONS.md D-012.
 *
 * `spend` cents at `multiplier` points per dollar, each point worth `valueMicro`
 * micro-cents:
 *
 * ```
 *   points        = spend / 100 × multiplier
 *   valueInCents  = points × valueMicro / 10000
 *               ⇒ spend × multiplier × valueMicro / 1_000_000
 * ```
 *
 * Collapsing it to a single division means one rounding site instead of three,
 * which is what keeps the fixtures exact.
 */
export function valuePoints(spend: Cents, multiplier: number, valueMicro: number): Cents {
  return cents((spend * multiplier * valueMicro) / (100 * MICRO_PER_CENT));
}

/** Clamps to a floor of zero. `max(0, n)` in step 10 of §3.3. */
export function atLeastZero(value: Cents): Cents {
  return (value < 0 ? 0 : value) as Cents;
}

/** The lesser of two cents values. `min(face, …)` in step 10 of §3.3. */
export function minCents(a: Cents, b: Cents): Cents {
  return (a < b ? a : b) as Cents;
}
