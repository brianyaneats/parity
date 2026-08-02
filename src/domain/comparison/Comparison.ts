import { AggregateRoot } from '../shared/AggregateRoot';
import { domainEvent } from '../shared/DomainEvent';
import { InvalidTransitionError, InvariantViolationError } from '../shared/DomainError';
import type { Channel, ChannelResult, ComparisonResult, StayContext } from '../engine/types';

export type ComparisonStatus = 'DRAFT' | 'DECIDED' | 'BOOKED' | 'ABANDONED';

const ALLOWED: Readonly<Record<ComparisonStatus, readonly ComparisonStatus[]>> = Object.freeze({
  DRAFT: ['DECIDED', 'ABANDONED'],
  DECIDED: ['BOOKED', 'ABANDONED', 'DRAFT'],
  BOOKED: [],
  ABANDONED: ['DRAFT'],
});

export interface ComparisonSnapshot {
  readonly context: StayContext;
  readonly results: readonly ChannelResult[];
  readonly engineVersion: string;
}

export interface ComparisonProps {
  readonly id: string;
  readonly userId: string;
  readonly tripId: string | null;
  readonly propertyId: string | null;
  readonly propertyNameSnapshot: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly snapshot: ComparisonSnapshot;
  readonly status: ComparisonStatus;
  readonly chosenChannel: Channel | null;
  readonly createdAt: Date;
  /** Set when this row was produced by recomputing an earlier one. */
  readonly recomputedFromId?: string | null;
}

/**
 * `Comparison` — an immutable historical record, not a live calculation.
 *
 * §4.3 is the rule and §13.3 predicts it will be gotten wrong: "The instinct is
 * to recompute everything on read. §4.3 forbids it. A saved comparison is a
 * historical record; recomputation creates a new record."
 *
 * That is enforced structurally here rather than by discipline:
 *
 * - `snapshot` is exposed through a getter that returns a frozen object, and
 *   there is no setter, no `updateSnapshot`, and no mutating method that
 *   touches it. The only way to get different numbers is `recomputeAs()`, which
 *   returns a **new aggregate with a new id**.
 * - `propertyNameSnapshot` is a copy, not a join. Renaming a property must not
 *   silently rewrite what a six-month-old comparison says it was about.
 *
 * This is what makes §1.5's fourth success criterion achievable: "the savings
 * ledger's cumulative figure survives the user's own audit — i.e., every number
 * is traceable to inputs they recognize."
 */
export class Comparison extends AggregateRoot {
  public readonly userId: string;
  public readonly tripId: string | null;
  public readonly propertyId: string | null;
  public readonly propertyNameSnapshot: string;
  public readonly checkIn: string;
  public readonly checkOut: string;
  public readonly nights: number;
  public readonly createdAt: Date;
  public readonly recomputedFromId: string | null;

  private readonly snapshotData: ComparisonSnapshot;
  private currentStatus: ComparisonStatus;
  private chosen: Channel | null;

  private constructor(props: ComparisonProps) {
    super(props.id);
    this.userId = props.userId;
    this.tripId = props.tripId;
    this.propertyId = props.propertyId;
    this.propertyNameSnapshot = props.propertyNameSnapshot;
    this.checkIn = props.checkIn;
    this.checkOut = props.checkOut;
    this.nights = props.nights;
    this.createdAt = props.createdAt;
    this.recomputedFromId = props.recomputedFromId ?? null;
    this.currentStatus = props.status;
    this.chosen = props.chosenChannel;

    // Frozen at construction. Nothing downstream can reach in and edit a
    // historical figure, deliberately or by accident.
    this.snapshotData = Object.freeze({
      context: Object.freeze({ ...props.snapshot.context }),
      results: Object.freeze([...props.snapshot.results]),
      engineVersion: props.snapshot.engineVersion,
    });
  }

  public static rehydrate(props: ComparisonProps): Comparison {
    return new Comparison(props);
  }

  public static create(params: {
    id: string;
    userId: string;
    tripId?: string | null;
    propertyId?: string | null;
    propertyName: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    outcome: ComparisonResult;
    context: StayContext;
    now: Date;
    recomputedFromId?: string | null;
  }): Comparison {
    if (params.nights < 1) {
      throw new InvariantViolationError('A comparison must cover at least one night.', {
        nights: params.nights,
      });
    }

    const comparison = new Comparison({
      id: params.id,
      userId: params.userId,
      tripId: params.tripId ?? null,
      propertyId: params.propertyId ?? null,
      propertyNameSnapshot: params.propertyName,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      nights: params.nights,
      snapshot: {
        context: params.context,
        results: params.outcome.results,
        engineVersion: params.outcome.engineVersion,
      },
      status: 'DRAFT',
      chosenChannel: null,
      createdAt: params.now,
      recomputedFromId: params.recomputedFromId ?? null,
    });

    comparison.recordEvent(
      domainEvent('comparison.saved', comparison.id, params.now, {
        userId: params.userId,
        engineVersion: params.outcome.engineVersion,
        winner: params.outcome.winner?.channel ?? null,
        recomputedFromId: params.recomputedFromId ?? null,
      }),
    );

    return comparison;
  }

  /** The frozen historical record. There is deliberately no setter. */
  public get snapshot(): ComparisonSnapshot {
    return this.snapshotData;
  }

  public get engineVersion(): string {
    return this.snapshotData.engineVersion;
  }

  public get status(): ComparisonStatus {
    return this.currentStatus;
  }

  public get chosenChannel(): Channel | null {
    return this.chosen;
  }

  /** The winner as computed at the time. Re-derived from the snapshot, not recomputed. */
  public get winner(): ChannelResult | null {
    return this.snapshotData.results.reduce<ChannelResult | null>(
      (best, candidate) =>
        best === null || candidate.effectiveNetCents < best.effectiveNetCents ? candidate : best,
      null,
    );
  }

  /**
   * Whether this record was produced by an engine version other than the
   * current one.
   *
   * §4.3 requires the UI to render a saved comparison from its snapshot with a
   * subtle "computed under engine v1.0.2" note — not to quietly refresh it.
   */
  public wasComputedUnder(currentEngineVersion: string): boolean {
    return this.snapshotData.engineVersion !== currentEngineVersion;
  }

  /**
   * Produces a **new** comparison from a fresh computation. This one is
   * untouched.
   *
   * §5.2: "POST /api/comparisons/:id/recompute — Creates a **new** comparison
   * row from current rules. Never mutates the original."
   */
  public recomputeAs(params: {
    id: string;
    outcome: ComparisonResult;
    context: StayContext;
    now: Date;
  }): Comparison {
    return Comparison.create({
      id: params.id,
      userId: this.userId,
      tripId: this.tripId,
      propertyId: this.propertyId,
      propertyName: this.propertyNameSnapshot,
      checkIn: this.checkIn,
      checkOut: this.checkOut,
      nights: this.nights,
      outcome: params.outcome,
      context: params.context,
      now: params.now,
      recomputedFromId: this.id,
    });
  }

  /**
   * Records which channel the user actually chose — the measurement behind
   * §1.5's first success criterion, that the ranked #1 is the one they book at
   * least 80% of the time.
   */
  public decide(channel: Channel, now: Date): void {
    if (!this.snapshotData.results.some((result) => result.channel === channel)) {
      throw new InvariantViolationError(
        'Cannot choose a channel that was not part of this comparison.',
        { channel },
      );
    }
    this.transitionTo('DECIDED', now);
    this.chosen = channel;
  }

  public transitionTo(next: ComparisonStatus, now: Date): void {
    if (this.currentStatus === next) return;
    if (!ALLOWED[this.currentStatus].includes(next)) {
      throw new InvalidTransitionError('Comparison', this.currentStatus, next);
    }

    const previous = this.currentStatus;
    this.currentStatus = next;
    this.recordEvent(
      domainEvent('comparison.status_changed', this.id, now, { from: previous, to: next }),
    );
  }

  /**
   * Whether the ranked winner is the channel the user actually booked.
   * Null when nothing has been chosen yet.
   */
  public followedRecommendation(): boolean | null {
    if (this.chosen === null) return null;
    return this.winner?.channel === this.chosen;
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      userId: this.userId,
      tripId: this.tripId,
      propertyId: this.propertyId,
      propertyNameSnapshot: this.propertyNameSnapshot,
      checkIn: this.checkIn,
      checkOut: this.checkOut,
      nights: this.nights,
      status: this.currentStatus,
      chosenChannel: this.chosen,
      engineVersion: this.snapshotData.engineVersion,
      recomputedFromId: this.recomputedFromId,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
