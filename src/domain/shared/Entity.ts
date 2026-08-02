/**
 * Entity base — DDD building block.
 *
 * An entity is defined by its identity, not its attributes: a `Booking` whose
 * total changes is still the same booking. Equality is therefore by id, which
 * is the opposite of `ValueObject`.
 */
export abstract class Entity<TId extends string = string> {
  protected constructor(public readonly id: TId) {}

  public equals(other?: Entity<TId> | null): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (!(other instanceof Entity)) return false;
    return this.id === other.id;
  }
}
