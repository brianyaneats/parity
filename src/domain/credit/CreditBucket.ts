import { AggregateRoot } from '../shared/AggregateRoot';
import { domainEvent } from '../shared/DomainEvent';
import { InvariantViolationError } from '../shared/DomainError';
import { type Cents, cents, sumCents, subtractCents, minCents, atLeastZero } from '../shared/cents';
import { BUCKET_CRITICAL_DAYS, BUCKET_WARNING_DAYS, type CreditBucketKey } from '../rules/credit.rules';
import { daysRemainingIn, windowContains, type DateWindow } from './CreditWindow';

/**
 * `CreditBucket` — the aggregate that owns the clawback rule (§2.4).
 *
 * The formula is four lines and it is the most valuable arithmetic in the
 * product, so it lives in exactly one place rather than being re-derived at
 * each call site:
 *
 * ```
 * netCharge    = total − refund
 * creditKept   = min(face, max(0, netCharge))
 * clawback     = face − creditKept
 * minCashFloor = face + expectedRefund
 * ```
 *
 * The engine computes the same thing for a hypothetical booking; this aggregate
 * applies it to a *real* one and tracks what the bucket has actually absorbed.
 * They agree because both read the same rule constants, and a test asserts they
 * agree on the TC-05 fixture.
 */

export type BucketStatus = 'NEUTRAL' | 'WARNING' | 'CRITICAL' | 'EXPIRED';

export interface CreditBucketProps {
  readonly id: string;
  readonly userId: string;
  readonly cardId: string | null;
  readonly key: CreditBucketKey | string;
  readonly label: string;
  readonly faceCents: Cents;
  readonly window: DateWindow;
  readonly consumedCents: Cents;
  /** True when the window was assumed rather than known — §2.4, D-063. */
  readonly windowAssumed?: boolean;
}

export class CreditBucket extends AggregateRoot {
  public readonly userId: string;
  public readonly cardId: string | null;
  public readonly key: string;
  public readonly label: string;
  public readonly faceCents: Cents;
  public readonly window: DateWindow;
  public readonly windowAssumed: boolean;

  private consumed: Cents;

  private constructor(props: CreditBucketProps) {
    super(props.id);
    this.userId = props.userId;
    this.cardId = props.cardId;
    this.key = props.key;
    this.label = props.label;
    this.faceCents = props.faceCents;
    this.window = props.window;
    this.consumed = props.consumedCents;
    this.windowAssumed = props.windowAssumed ?? false;
  }

  public static create(props: CreditBucketProps): CreditBucket {
    if (props.faceCents < 0) {
      throw new InvariantViolationError('A credit bucket cannot have a negative face value.', {
        faceCents: props.faceCents,
      });
    }
    if (props.consumedCents < 0) {
      throw new InvariantViolationError('A credit bucket cannot have consumed a negative amount.', {
        consumedCents: props.consumedCents,
      });
    }
    if (props.window.end < props.window.start) {
      throw new InvariantViolationError('A credit window cannot end before it starts.', {
        window: props.window,
      });
    }
    return new CreditBucket(props);
  }

  public get consumedCents(): Cents {
    return this.consumed;
  }

  public get remainingCents(): Cents {
    return atLeastZero(subtractCents(this.faceCents, this.consumed));
  }

  public get isExhausted(): boolean {
    return this.remainingCents === 0;
  }

  /**
   * Whether a booking made on `bookingDate` falls in this window.
   *
   * Deliberately named for the *booking* date. §7.5: a booking prepaid now for
   * a stay next year still burns this window's credit, and that is the
   * highest-leverage non-obvious move the app can surface.
   */
  public acceptsBookingOn(bookingIsoDate: string): boolean {
    return windowContains(this.window, bookingIsoDate) && !this.isExhausted;
  }

  public daysRemaining(todayIsoDate: string): number {
    return daysRemainingIn(this.window, todayIsoDate);
  }

  /**
   * Status band for the §7.5 meter: over 60 days neutral, 30–60 warning, under
   * 30 critical. Returned as a band rather than a colour so the component pairs
   * it with an icon and a label — §6.7 forbids colour as the sole carrier.
   */
  public status(todayIsoDate: string): BucketStatus {
    const days = this.daysRemaining(todayIsoDate);
    if (days < 0) return 'EXPIRED';
    if (days < BUCKET_CRITICAL_DAYS) return 'CRITICAL';
    if (days <= BUCKET_WARNING_DAYS) return 'WARNING';
    return 'NEUTRAL';
  }

  /**
   * How much of this bucket a charge of `netChargeCents` would actually keep,
   * and how much would be clawed back — §2.4.
   *
   * `netCharge` is what remains **after** any price-match refund. Passing the
   * gross total here is the bug fixture TC-05 exists to catch.
   */
  public assess(netChargeCents: Cents): {
    keptCents: Cents;
    clawbackCents: Cents;
  } {
    const available = this.remainingCents;
    const kept = minCents(available, atLeastZero(netChargeCents));
    return { keptCents: kept, clawbackCents: subtractCents(available, kept) };
  }

  /**
   * The cash floor to charge so the whole remaining credit survives a refund.
   *
   * §8.3 requires this phrased as an instruction naming the number and the
   * consequence — "Charge at least $472.37 to the card and cover the rest with
   * points, or you'll lose part of the $250 credit" — not as a statistic.
   */
  public minCashFloorCents(expectedRefundCents: Cents): Cents {
    return sumCents(this.remainingCents, expectedRefundCents);
  }

  /** Records real consumption. Cannot exceed the face — the issuer caps it too. */
  public consume(amountCents: Cents, occurredAt: Date, bookingId?: string): Cents {
    if (amountCents < 0) {
      throw new InvariantViolationError('Cannot consume a negative amount of a credit.', {
        amountCents,
      });
    }

    const applied = minCents(amountCents, this.remainingCents);
    this.consumed = cents(this.consumed + applied);

    this.recordEvent(
      domainEvent('credit.consumed', this.id, occurredAt, {
        key: this.key,
        appliedCents: applied,
        remainingCents: this.remainingCents,
        ...(bookingId ? { bookingId } : {}),
      }),
    );

    return applied;
  }

  /** Reverses consumption — a cancelled booking releases what it held. */
  public release(amountCents: Cents, occurredAt: Date): Cents {
    if (amountCents < 0) {
      throw new InvariantViolationError('Cannot release a negative amount of a credit.', {
        amountCents,
      });
    }

    const released = minCents(amountCents, this.consumed);
    this.consumed = subtractCents(this.consumed, released);

    this.recordEvent(
      domainEvent('credit.released', this.id, occurredAt, {
        key: this.key,
        releasedCents: released,
        remainingCents: this.remainingCents,
      }),
    );

    return released;
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      userId: this.userId,
      cardId: this.cardId,
      key: this.key,
      label: this.label,
      faceCents: this.faceCents,
      consumedCents: this.consumed,
      remainingCents: this.remainingCents,
      window: this.window,
      windowAssumed: this.windowAssumed,
    };
  }
}

/**
 * Total unburned credit across every live bucket — the headline figure on
 * `/credits` (§7.5): "the number that costs real money if ignored."
 */
export function totalUnburnedCents(
  buckets: readonly CreditBucket[],
  todayIsoDate: string,
): Cents {
  return cents(
    buckets
      .filter((bucket) => bucket.daysRemaining(todayIsoDate) >= 0)
      .reduce((sum, bucket) => sum + bucket.remainingCents, 0),
  );
}

/** The nearest expiry among buckets that still hold money. */
export function nearestExpiry(
  buckets: readonly CreditBucket[],
  todayIsoDate: string,
): CreditBucket | null {
  const live = buckets
    .filter((bucket) => !bucket.isExhausted && bucket.daysRemaining(todayIsoDate) >= 0)
    .sort((a, b) => a.window.end.localeCompare(b.window.end));
  return live[0] ?? null;
}
