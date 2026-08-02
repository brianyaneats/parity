import { Entity } from './Entity';
import type { DomainEvent } from './DomainEvent';

/**
 * Aggregate root — the consistency boundary.
 *
 * Everything outside an aggregate references it only by id and only through its
 * root. That is what lets `Claim` own its whole state machine (§7.4) in one
 * place instead of scattering the "an expired claim can only go to EXPIRED or
 * NOT_PURSUED" rule across the API, the UI and the cron sweep.
 */
export abstract class AggregateRoot<TId extends string = string> extends Entity<TId> {
  private domainEvents: DomainEvent[] = [];

  protected recordEvent(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  /**
   * Hands over the recorded events and clears the buffer, so a double-drain
   * cannot double-dispatch. Called by the use case, never by the aggregate.
   */
  public pullDomainEvents(): readonly DomainEvent[] {
    const drained = this.domainEvents;
    this.domainEvents = [];
    return Object.freeze(drained);
  }

  /** Peek without draining. For assertions in tests. */
  public get pendingEvents(): readonly DomainEvent[] {
    return Object.freeze([...this.domainEvents]);
  }
}
