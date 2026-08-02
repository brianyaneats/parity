import { AggregateRoot } from '../shared/AggregateRoot';
import { domainEvent } from '../shared/DomainEvent';
import { InvalidTransitionError, InvariantViolationError } from '../shared/DomainError';
import { addHours, msUntil, type Clock } from '../shared/Clock';
import { type Cents, atLeastZero } from '../shared/cents';
import { PM_CLAIM_WINDOW_HOURS_RULE } from '../rules/price-match.rules';
import {
  ALLOWED_TRANSITIONS,
  OPEN_STATUSES,
  RESOLVED_WITH_AWARD,
  TERMINAL_STATUSES,
  type ClaimStatus,
} from './ClaimStatus';

export type ClaimKind =
  | 'CHASE_PM'
  | 'AMEX_LRG'
  | 'BRG_HILTON'
  | 'BRG_MARRIOTT'
  | 'BRG_HYATT'
  | 'BRG_IHG'
  | 'BRG_WYNDHAM'
  | 'BRG_CHOICE'
  | 'BRG_BEST_WESTERN';

export interface ClaimProps {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string;
  readonly competingRateId: string | null;
  readonly kind: ClaimKind;
  readonly deadlineAt: Date;
  readonly status: ClaimStatus;
  readonly claimedGapCents: Cents | null;
  readonly awardedCents: Cents | null;
  readonly submittedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly denialReason: string | null;
  readonly notes: string | null;
}

/**
 * `Claim` — the aggregate that defends the 24-hour window.
 *
 * §1.5 lists "no price-match claim window is ever missed on a Chase Travel
 * booking" as a success criterion, and §13.3 warns that "the 24-hour window is
 * time-math-heavy and time math is where bugs live."
 *
 * Two decisions follow from that:
 *
 * 1. **The deadline is absolute-duration arithmetic on epoch milliseconds**, not
 *    calendar-field manipulation. A claim booked at 23:30 the night the clocks
 *    change is still due exactly 24 hours later, not 23 or 25.
 * 2. **Time is injected.** Every method that needs "now" takes a `Clock` or a
 *    `Date`. §10.2 forbids mocking time in a way that hides a timezone bug;
 *    injecting it is how the DST and UTC-midnight tests become possible at all.
 */
export class Claim extends AggregateRoot {
  public readonly userId: string;
  public readonly bookingId: string;
  public readonly kind: ClaimKind;
  public readonly deadlineAt: Date;
  public readonly claimedGapCents: Cents | null;

  private currentStatus: ClaimStatus;
  private competingRate: string | null;
  private awarded: Cents | null;
  private submitted: Date | null;
  private resolved: Date | null;
  private denial: string | null;
  private note: string | null;

  private constructor(props: ClaimProps) {
    super(props.id);
    this.userId = props.userId;
    this.bookingId = props.bookingId;
    this.kind = props.kind;
    this.deadlineAt = props.deadlineAt;
    this.claimedGapCents = props.claimedGapCents;
    this.currentStatus = props.status;
    this.competingRate = props.competingRateId;
    this.awarded = props.awardedCents;
    this.submitted = props.submittedAt;
    this.resolved = props.resolvedAt;
    this.denial = props.denialReason;
    this.note = props.notes;
  }

  public static rehydrate(props: ClaimProps): Claim {
    return new Claim(props);
  }

  /**
   * Opens a claim for a booking — the side effect §5.2 requires on
   * `POST /api/bookings`: "if channel is EDIT or CHASE_TRAVEL and prepaid,
   * auto-create a `claims` row with `deadline_at = booked_at + 24h`, status
   * ELIGIBLE."
   *
   * §7.4's acceptance criterion is exact: "a claim created from a booking at
   * time T has `deadline_at = T + 24h` exactly."
   */
  public static openForBooking(params: {
    id: string;
    userId: string;
    bookingId: string;
    kind: ClaimKind;
    bookedAt: Date;
    claimedGapCents?: Cents | null;
    competingRateId?: string | null;
    windowHours?: number;
  }): Claim {
    const windowHours = params.windowHours ?? PM_CLAIM_WINDOW_HOURS_RULE.value;
    const deadlineAt = addHours(params.bookedAt, windowHours);

    const claim = new Claim({
      id: params.id,
      userId: params.userId,
      bookingId: params.bookingId,
      competingRateId: params.competingRateId ?? null,
      kind: params.kind,
      deadlineAt,
      status: 'ELIGIBLE',
      claimedGapCents: params.claimedGapCents ?? null,
      awardedCents: null,
      submittedAt: null,
      resolvedAt: null,
      denialReason: null,
      notes: null,
    });

    claim.recordEvent(
      domainEvent('claim.opened', claim.id, params.bookedAt, {
        bookingId: params.bookingId,
        kind: params.kind,
        deadlineAt: deadlineAt.toISOString(),
      }),
    );

    return claim;
  }

  public get status(): ClaimStatus {
    return this.currentStatus;
  }
  public get competingRateId(): string | null {
    return this.competingRate;
  }
  public get awardedCents(): Cents | null {
    return this.awarded;
  }
  public get submittedAt(): Date | null {
    return this.submitted;
  }
  public get resolvedAt(): Date | null {
    return this.resolved;
  }
  public get denialReason(): string | null {
    return this.denial;
  }
  public get notes(): string | null {
    return this.note;
  }

  public get isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this.currentStatus);
  }

  public get isOpen(): boolean {
    return OPEN_STATUSES.has(this.currentStatus);
  }

  /** Whether the submission window has closed. */
  public hasPassedDeadline(now: Date): boolean {
    return now.getTime() > this.deadlineAt.getTime();
  }

  /** Milliseconds left to submit, floored at zero — never a negative countdown. */
  public msRemaining(now: Date): number {
    return msUntil(now, this.deadlineAt);
  }

  /**
   * Moves the claim to `next`, enforcing both the transition table and the
   * deadline.
   *
   * The deadline gate applies only to entering `SUBMITTED`: the 24 hours govern
   * *submission*, not the issuer's response time, so a claim submitted in time
   * can still be resolved days later.
   */
  public transitionTo(
    next: ClaimStatus,
    now: Date,
    details: { awardedCents?: Cents | null; denialReason?: string | null; notes?: string | null } = {},
  ): void {
    if (!ALLOWED_TRANSITIONS[this.currentStatus].includes(next)) {
      throw new InvalidTransitionError('Claim', this.currentStatus, next);
    }

    // §7.4: "an expired claim can no longer be marked SUBMITTED, only EXPIRED
    // or NOT_PURSUED."
    if (next === 'SUBMITTED' && this.hasPassedDeadline(now)) {
      throw new InvalidTransitionError('Claim', `${this.currentStatus} (past deadline)`, next);
    }

    // §5.2: "on APPROVED/PARTIAL require `awarded_cents`."
    if (RESOLVED_WITH_AWARD.has(next)) {
      const awarded = details.awardedCents;
      if (awarded === undefined || awarded === null) {
        throw new InvariantViolationError(
          `Recording a claim as ${next} requires the amount that was actually awarded.`,
          { status: next },
        );
      }
      if (awarded < 0) {
        throw new InvariantViolationError('An awarded amount cannot be negative.', { awarded });
      }
      this.awarded = awarded;
    }

    const previous = this.currentStatus;
    this.currentStatus = next;

    if (next === 'SUBMITTED') this.submitted = now;
    if (TERMINAL_STATUSES.has(next)) this.resolved = now;
    if (details.denialReason !== undefined) this.denial = details.denialReason;
    if (details.notes !== undefined) this.note = details.notes;

    this.recordEvent(
      domainEvent('claim.transitioned', this.id, now, {
        from: previous,
        to: next,
        bookingId: this.bookingId,
        ...(this.awarded !== null ? { awardedCents: this.awarded } : {}),
      }),
    );
  }

  /**
   * Auto-expiry, driven by the every-15-minutes sweep in Part 9.
   *
   * Idempotent: a double-fire cannot double-transition, because a claim that is
   * already terminal returns false without recording an event. Part 9 requires
   * every job to be idempotent, and this is where that is actually enforced.
   */
  public expireIfPastDeadline(clock: Clock): boolean {
    const now = clock.now();
    if (!this.isOpen || !this.hasPassedDeadline(now)) return false;

    this.transitionTo('EXPIRED', now);
    return true;
  }

  /**
   * Attaches the competing rate the claim is made against.
   *
   * §5.2: the `screenshot_key` column lives on `competing_rates`, so "a claim
   * with no `competing_rate_id` must create one first."
   */
  public attachCompetingRate(competingRateId: string, now: Date): void {
    if (this.isTerminal) {
      throw new InvariantViolationError('Cannot attach evidence to a resolved claim.', {
        status: this.currentStatus,
      });
    }
    this.competingRate = competingRateId;
    this.recordEvent(
      domainEvent('claim.evidence_attached', this.id, now, { competingRateId }),
    );
  }

  /**
   * What actually landed, for the ledger.
   *
   * §8.6 distinguishes projected from realised, and only realised figures reach
   * the headline. A denied claim realised nothing, so it contributes zero
   * rather than being quietly omitted — the difference matters when the user
   * audits the ledger against their statement.
   */
  public realisedSavingCents(): Cents {
    if (!RESOLVED_WITH_AWARD.has(this.currentStatus)) return atLeastZero(0 as Cents);
    return this.awarded ?? atLeastZero(0 as Cents);
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      userId: this.userId,
      bookingId: this.bookingId,
      competingRateId: this.competingRate,
      kind: this.kind,
      deadlineAt: this.deadlineAt.toISOString(),
      status: this.currentStatus,
      claimedGapCents: this.claimedGapCents,
      awardedCents: this.awarded,
      submittedAt: this.submitted?.toISOString() ?? null,
      resolvedAt: this.resolved?.toISOString() ?? null,
      denialReason: this.denial,
      notes: this.note,
    };
  }
}
