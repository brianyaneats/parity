/**
 * Domain errors — thrown when an invariant the domain owns is violated.
 *
 * These are distinct from validation errors at the API boundary: a validation
 * error means the *user* sent something wrong, a domain error means the *code*
 * reached a state the model says is impossible. Both are surfaced through the
 * §5.1 envelope, but only the second is a bug.
 */
export class DomainError extends Error {
  public readonly code: string;
  public readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = Object.freeze({ ...details });
    // Preserve the prototype chain across the ES5 target downlevel.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An aggregate was asked to make a transition its state machine forbids. */
export class InvalidTransitionError extends DomainError {
  constructor(aggregate: string, from: string, to: string) {
    super(
      'INVALID_TRANSITION',
      `${aggregate} cannot move from ${from} to ${to}.`,
      { aggregate, from, to },
    );
    this.name = 'InvalidTransitionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A value object was constructed with a value outside its legal range. */
export class InvariantViolationError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('INVARIANT_VIOLATION', message, details);
    this.name = 'InvariantViolationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
