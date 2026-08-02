/**
 * Value object base — DDD building block.
 *
 * A value object has no identity: two instances carrying the same values *are*
 * the same thing. Equality is structural, and instances are frozen so that
 * sharing one across aggregates can never produce spooky action at a distance.
 */
export abstract class ValueObject<T extends Record<string, unknown>> {
  protected readonly props: Readonly<T>;

  protected constructor(props: T) {
    this.props = Object.freeze({ ...props });
  }

  /**
   * Structural equality over the frozen props. Nested value objects compare
   * through their own `equals`, so composition works without extra plumbing.
   */
  public equals(other?: ValueObject<T> | null): boolean {
    if (other === null || other === undefined) return false;
    if (other === this) return true;
    if (other.constructor !== this.constructor) return false;

    const mine = this.props as Record<string, unknown>;
    const theirs = other.props as Record<string, unknown>;
    const keys = Object.keys(mine);
    if (keys.length !== Object.keys(theirs).length) return false;

    return keys.every((key) => {
      const a = mine[key];
      const b = theirs[key];
      if (a instanceof ValueObject) return a.equals(b as ValueObject<never>);
      return Object.is(a, b);
    });
  }

  /** A stable, structural snapshot. Useful for logging and for test diffs. */
  public toJSON(): Readonly<T> {
    return this.props;
  }
}
