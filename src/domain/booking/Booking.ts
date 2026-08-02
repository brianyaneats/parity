import { AggregateRoot } from '../shared/AggregateRoot';
import { domainEvent } from '../shared/DomainEvent';
import { InvalidTransitionError, InvariantViolationError } from '../shared/DomainError';
import { type Cents, subtractCents, atLeastZero } from '../shared/cents';
import { PRICE_MATCHABLE_CHANNELS, type Channel } from '../rules/channels.rules';

export type BookingStatus = 'ACTIVE' | 'CANCELLED' | 'COMPLETED';

export interface BookingProps {
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
  readonly prepaid: boolean;
  readonly refundable: boolean;
  readonly cancelDeadline: string | null;
  readonly bucketId: string | null;
  readonly status: BookingStatus;
}

const ALLOWED: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = Object.freeze({
  ACTIVE: ['CANCELLED', 'COMPLETED'],
  CANCELLED: [],
  COMPLETED: [],
});

/**
 * `Booking` — the record of what the user actually did.
 *
 * Its job is to make the claim in §5.2 a *consequence of the domain* rather than
 * a side effect buried in a route handler: recording a booking on a
 * price-matchable prepaid channel raises `booking.recorded` carrying everything
 * the claim needs, and the use case turns that into a `Claim` inside the same
 * transaction.
 *
 * Writing that logic in the route would work exactly once — until a second
 * caller (the seed script, an import, a test fixture) creates a booking and
 * silently gets no claim.
 */
export class Booking extends AggregateRoot {
  public readonly userId: string;
  public readonly comparisonId: string | null;
  public readonly channel: Channel;
  public readonly bookedAt: Date;
  public readonly checkIn: string;
  public readonly checkOut: string;
  public readonly totalCents: Cents;
  public readonly baseCents: Cents;
  public readonly prepaid: boolean;
  public readonly refundable: boolean;
  public readonly cancelDeadline: string | null;

  private confirmation: string | null;
  private cashCharged: Cents | null;
  private points: number | null;
  private bucket: string | null;
  private currentStatus: BookingStatus;

  private constructor(props: BookingProps) {
    super(props.id);
    this.userId = props.userId;
    this.comparisonId = props.comparisonId;
    this.channel = props.channel;
    this.bookedAt = props.bookedAt;
    this.checkIn = props.checkIn;
    this.checkOut = props.checkOut;
    this.totalCents = props.totalCents;
    this.baseCents = props.baseCents;
    this.prepaid = props.prepaid;
    this.refundable = props.refundable;
    this.cancelDeadline = props.cancelDeadline;
    this.confirmation = props.confirmationNumber;
    this.cashCharged = props.cashChargedCents;
    this.points = props.pointsUsed;
    this.bucket = props.bucketId;
    this.currentStatus = props.status;
  }

  public static rehydrate(props: BookingProps): Booking {
    return new Booking(props);
  }

  /**
   * Records a new booking and raises `booking.recorded`.
   *
   * The event payload carries `opensClaim` and the claim's kind so the use case
   * does not have to re-derive the eligibility rule — the domain decided it.
   */
  public static record(props: Omit<BookingProps, 'status'>): Booking {
    if (props.totalCents < 0) {
      throw new InvariantViolationError('A booking total cannot be negative.', {
        totalCents: props.totalCents,
      });
    }
    if (props.checkOut <= props.checkIn) {
      throw new InvariantViolationError('Check-out must be after check-in.', {
        checkIn: props.checkIn,
        checkOut: props.checkOut,
      });
    }

    const booking = new Booking({ ...props, status: 'ACTIVE' });

    booking.recordEvent(
      domainEvent('booking.recorded', booking.id, props.bookedAt, {
        userId: props.userId,
        channel: props.channel,
        prepaid: props.prepaid,
        totalCents: props.totalCents,
        // §5.2: "if channel is EDIT or CHASE_TRAVEL and prepaid, auto-create a
        // claims row with deadline_at = booked_at + 24h, status ELIGIBLE."
        opensClaim: booking.opensPriceMatchClaim,
        claimKind: booking.opensPriceMatchClaim ? 'CHASE_PM' : null,
      }),
    );

    return booking;
  }

  /**
   * Whether this booking is eligible for an issuer price-match claim.
   *
   * Reads the channel catalog rather than hardcoding `EDIT` and `CHASE_TRAVEL`,
   * so adding a price-matchable channel to §2.2 automatically starts opening
   * claims for it instead of requiring someone to remember this line.
   */
  public get opensPriceMatchClaim(): boolean {
    return PRICE_MATCHABLE_CHANNELS.has(this.channel) && this.prepaid;
  }

  public get status(): BookingStatus {
    return this.currentStatus;
  }
  public get confirmationNumber(): string | null {
    return this.confirmation;
  }
  public get cashChargedCents(): Cents | null {
    return this.cashCharged;
  }
  public get pointsUsed(): number | null {
    return this.points;
  }
  public get bucketId(): string | null {
    return this.bucket;
  }

  /**
   * Whether this booking is still worth re-shopping — §7.6.
   *
   * Only refundable bookings with a future cancellation deadline. §9's
   * `watchlist-reshop` job additionally requires the deadline to be at least two
   * days out, because a reminder that arrives with no time to act on it is
   * noise.
   */
  public isReshoppable(todayIsoDate: string): boolean {
    return (
      this.currentStatus === 'ACTIVE' &&
      this.refundable &&
      this.cancelDeadline !== null &&
      this.cancelDeadline > todayIsoDate
    );
  }

  /**
   * How much cash actually hit the card, which is what a statement credit keys
   * off (§2.4). Falls back to the total when the split was not recorded — the
   * conservative reading, since assuming more points than were used would
   * overstate the clawback risk and nag the user about a problem they do not have.
   */
  public effectiveCashChargedCents(): Cents {
    return this.cashCharged ?? this.totalCents;
  }

  /** What remains charged after a refund lands. Input to the clawback rule. */
  public netChargeAfterRefund(refundCents: Cents): Cents {
    return atLeastZero(subtractCents(this.effectiveCashChargedCents(), refundCents));
  }

  public recordConfirmation(confirmationNumber: string, now: Date): void {
    this.confirmation = confirmationNumber;
    this.recordEvent(domainEvent('booking.confirmed', this.id, now, {}));
  }

  public recordPaymentSplit(cashCents: Cents, pointsUsed: number, now: Date): void {
    if (cashCents < 0 || pointsUsed < 0) {
      throw new InvariantViolationError('A payment split cannot be negative.', {
        cashCents,
        pointsUsed,
      });
    }
    this.cashCharged = cashCents;
    this.points = pointsUsed;
    this.recordEvent(
      domainEvent('booking.payment_recorded', this.id, now, { cashCents, pointsUsed }),
    );
  }

  public assignBucket(bucketId: string, now: Date): void {
    this.bucket = bucketId;
    this.recordEvent(domainEvent('booking.bucket_assigned', this.id, now, { bucketId }));
  }

  public transitionTo(next: BookingStatus, now: Date): void {
    if (!ALLOWED[this.currentStatus].includes(next)) {
      throw new InvalidTransitionError('Booking', this.currentStatus, next);
    }
    const previous = this.currentStatus;
    this.currentStatus = next;

    this.recordEvent(
      domainEvent(next === 'CANCELLED' ? 'booking.cancelled' : 'booking.completed', this.id, now, {
        from: previous,
        // A cancelled booking releases whatever credit it was holding.
        releasesBucket: next === 'CANCELLED' ? this.bucket : null,
      }),
    );
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      userId: this.userId,
      comparisonId: this.comparisonId,
      channel: this.channel,
      confirmationNumber: this.confirmation,
      bookedAt: this.bookedAt.toISOString(),
      checkIn: this.checkIn,
      checkOut: this.checkOut,
      totalCents: this.totalCents,
      baseCents: this.baseCents,
      cashChargedCents: this.cashCharged,
      pointsUsed: this.points,
      prepaid: this.prepaid,
      refundable: this.refundable,
      cancelDeadline: this.cancelDeadline,
      bucketId: this.bucket,
      status: this.currentStatus,
    };
  }
}
