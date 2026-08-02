/**
 * Domain events — DECISIONS.md D-032.
 *
 * Aggregates record what happened rather than reaching across boundaries to
 * cause it. `BookingRecorded` is the one that matters in v1: it is what makes
 * the auto-created claim in §5.2 a consequence of the domain rather than a
 * side effect buried in a route handler.
 *
 * There is no event bus. Use cases drain `pullDomainEvents()` inside the same
 * transaction and dispatch synchronously. That is swappable for a real bus
 * later without touching a single aggregate.
 */
export interface DomainEvent {
  /** Discriminant, e.g. `'booking.recorded'`. */
  readonly type: string;
  /** Id of the aggregate that raised it. */
  readonly aggregateId: string;
  /** When it happened, from an injected clock — never `Date.now()` in a domain object. */
  readonly occurredAt: Date;
  /** Event-specific payload. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export function domainEvent(
  type: string,
  aggregateId: string,
  occurredAt: Date,
  payload: Record<string, unknown> = {},
): DomainEvent {
  return Object.freeze({
    type,
    aggregateId,
    occurredAt,
    payload: Object.freeze({ ...payload }),
  });
}
