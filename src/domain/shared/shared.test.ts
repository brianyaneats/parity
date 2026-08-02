import { describe, it, expect } from 'vitest';
import {
  roundHalfAwayFromZero,
  cents,
  bps,
  micro,
  ZERO_CENTS,
  sumCents,
  subtractCents,
  applyBps,
  stripInclusiveBps,
  addInclusiveBps,
  valuePoints,
  atLeastZero,
  minCents,
  type Cents,
} from './cents';
import { Money } from './Money';
import { ValueObject } from './ValueObject';
import { Entity } from './Entity';
import { AggregateRoot } from './AggregateRoot';
import { domainEvent, type DomainEvent } from './DomainEvent';
import { DomainError, InvalidTransitionError, InvariantViolationError } from './DomainError';
import {
  SystemClock,
  FixedClock,
  addHours,
  addDays,
  daysBetween,
  msUntil,
  MS_PER_HOUR,
  MS_PER_DAY,
} from './Clock';
import { ok, err, isOk, isErr, unwrap, mapResult } from './Result';

const C = (n: number): Cents => n as Cents;

// ============================================================== cents.ts

describe('roundHalfAwayFromZero — §3.1', () => {
  it('rounds an ordinary positive value the way Math.round would', () => {
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(2.6)).toBe(3);
  });

  it('rounds an ordinary negative value symmetrically', () => {
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(-2.6)).toBe(-3);
  });

  it('rounds a positive exact half up, away from zero', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
  });

  it('rounds a negative exact half down, away from zero — NOT Math.round behaviour', () => {
    // Math.round(-0.5) === -0 and Math.round(-2.5) === -2 (rounds half UP, i.e.
    // toward positive infinity). This function must diverge from that: a gap
    // that goes negative because the user's own rate beats the market must not
    // drift toward zero. See DECISIONS.md D-010.
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(Math.round(-0.5)).toBe(-0);
  });

  it('throws RangeError for a non-finite input rather than returning NaN or Infinity', () => {
    expect(() => roundHalfAwayFromZero(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => roundHalfAwayFromZero(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
    expect(() => roundHalfAwayFromZero(Number.NaN)).toThrow(RangeError);
  });
});

describe('cents / bps / micro constructors', () => {
  it('round their input the same way roundHalfAwayFromZero does', () => {
    expect(cents(2.5)).toBe(3);
    expect(cents(-2.5)).toBe(-3);
    expect(bps(12.5)).toBe(13);
    expect(bps(-12.5)).toBe(-13);
    expect(micro(4.5)).toBe(5);
    expect(micro(-4.5)).toBe(-5);
  });

  it('exposes a zero identity typed as Cents', () => {
    expect(ZERO_CENTS).toBe(0);
  });
});

describe('sumCents and subtractCents — §3.6', () => {
  it('sums an arbitrary number of cents values without leaving the branded type', () => {
    expect(sumCents(C(100), C(200), C(300))).toBe(600);
  });

  it('sums to zero when given no values', () => {
    expect(sumCents()).toBe(0);
  });

  it('subtracts b from a and allows a negative result', () => {
    expect(subtractCents(C(500), C(200))).toBe(300);
    expect(subtractCents(C(200), C(500))).toBe(-300);
  });
});

describe('applyBps', () => {
  it('applies a basis-point rate to a cents amount at a single rounding site', () => {
    // 12.40% of $1,000.00
    expect(applyBps(C(100_000), 1_240)).toBe(12_400);
  });

  it('rounds the result half away from zero', () => {
    // 100 * 25 / 10000 = 0.25 -> rounds to 0
    expect(applyBps(C(100), 25)).toBe(0);
    // 150 * 3333 / 10000 = 49.995 -> rounds to 50
    expect(applyBps(C(150), 3_333)).toBe(50);
  });
});

describe('stripInclusiveBps and addInclusiveBps — §3.3 step 1, §3.5', () => {
  it('strips an inclusive tax rate off a gross amount', () => {
    // base = 112_400 / 1.124 = 100_000 exactly, at a 12.40% inclusive rate
    expect(stripInclusiveBps(C(112_400), 1_240)).toBe(100_000);
  });

  it('adds an inclusive tax rate back onto a base amount', () => {
    expect(addInclusiveBps(C(100_000), 1_240)).toBe(112_400);
  });

  it('round-trips a gross amount through strip then add when the rate divides exactly', () => {
    const gross = C(112_400);
    const base = stripInclusiveBps(gross, 1_240);
    expect(addInclusiveBps(base, 1_240)).toBe(gross);
  });
});

describe('valuePoints — DECISIONS.md D-012', () => {
  it('values earned points as a single fused expression', () => {
    // $3,600 spend, 5x multiplier, 1.5c/point (15000 micro):
    // points = 3600 * 5 = 18000; value = 18000 * 15000 / 10000 = 27000 cents
    expect(valuePoints(C(360_000), 5, 15_000)).toBe(27_000);
  });

  it('returns zero for a channel that earns no points', () => {
    expect(valuePoints(C(360_000), 0, 15_000)).toBe(0);
  });
});

describe('atLeastZero — §3.3 step 10', () => {
  it('clamps a negative value to zero', () => {
    expect(atLeastZero(C(-500))).toBe(0);
  });

  it('leaves a non-negative value unchanged', () => {
    expect(atLeastZero(C(500))).toBe(500);
    expect(atLeastZero(C(0))).toBe(0);
  });
});

describe('minCents — §3.3 step 10', () => {
  it('returns the first value when it is the lesser', () => {
    expect(minCents(C(100), C(200))).toBe(100);
  });

  it('returns the second value when it is the lesser', () => {
    expect(minCents(C(200), C(100))).toBe(100);
  });
});

// ============================================================== Money.ts

describe('Money.fromCents', () => {
  it('constructs from an integer cents amount', () => {
    expect(Money.fromCents(1_050).amount).toBe(1_050);
  });

  it('rejects a non-integer amount', () => {
    expect(() => Money.fromCents(10.5)).toThrow(InvariantViolationError);
  });

  it('defaults to USD and normalises a lower-case currency code', () => {
    const money = Money.fromCents(100, 'usd');
    expect(money.currency).toBe('USD');
  });

  it('trims whitespace around a currency code', () => {
    expect(Money.fromCents(100, ' usd ').currency).toBe('USD');
  });

  it('rejects a currency code that is not exactly three letters', () => {
    expect(() => Money.fromCents(100, 'US')).toThrow(InvariantViolationError);
    expect(() => Money.fromCents(100, 'USDD')).toThrow(InvariantViolationError);
    expect(() => Money.fromCents(100, '123')).toThrow(InvariantViolationError);
  });
});

describe('Money.fromDollars — the one place a float is allowed to exist', () => {
  it('converts dollars to cents, rounding half away from zero', () => {
    expect(Money.fromDollars(19.995).amount).toBe(2_000);
  });

  it('rejects a non-finite amount', () => {
    expect(() => Money.fromDollars(Number.POSITIVE_INFINITY)).toThrow(InvariantViolationError);
    expect(() => Money.fromDollars(Number.NaN)).toThrow(InvariantViolationError);
  });
});

describe('Money.zero', () => {
  it('is zero-valued and reports isZero true', () => {
    const zero = Money.zero();
    expect(zero.amount).toBe(0);
    expect(zero.isZero).toBe(true);
  });
});

describe('Money value accessors', () => {
  it('exposes amount, currency and toCents consistently', () => {
    const money = Money.fromCents(500, 'EUR');
    expect(money.amount).toBe(500);
    expect(money.currency).toBe('EUR');
    expect(money.toCents()).toBe(500);
  });

  it('reports isZero and isNegative for both branches', () => {
    expect(Money.fromCents(0).isZero).toBe(true);
    expect(Money.fromCents(100).isZero).toBe(false);
    expect(Money.fromCents(-100).isNegative).toBe(true);
    expect(Money.fromCents(100).isNegative).toBe(false);
  });
});

describe('Money arithmetic', () => {
  it('adds two amounts in the same currency', () => {
    expect(Money.fromCents(100).plus(Money.fromCents(200)).amount).toBe(300);
  });

  it('refuses to add across currencies', () => {
    expect(() => Money.fromCents(100, 'USD').plus(Money.fromCents(100, 'EUR'))).toThrow(
      InvariantViolationError,
    );
  });

  it('subtracts two amounts in the same currency, allowing a negative result', () => {
    expect(Money.fromCents(100).minus(Money.fromCents(300)).amount).toBe(-200);
  });

  it('refuses to subtract across currencies', () => {
    expect(() => Money.fromCents(100, 'USD').minus(Money.fromCents(100, 'EUR'))).toThrow(
      InvariantViolationError,
    );
  });

  it('negates an amount', () => {
    expect(Money.fromCents(500).negated().amount).toBe(-500);
    expect(Money.fromCents(-500).negated().amount).toBe(500);
  });

  it('takes the absolute value of a positive or negative amount', () => {
    expect(Money.fromCents(500).abs().amount).toBe(500);
    expect(Money.fromCents(-500).abs().amount).toBe(500);
  });

  it('multiplies by a basis-point rate, rounding half away from zero', () => {
    expect(Money.fromCents(100_000).timesBps(1_240).amount).toBe(12_400);
    // -50 * 2500 / 10000 = -12.5, which must round to -13 (away from zero),
    // not -12 (Math.round's half-up behaviour).
    expect(Money.fromCents(-50).timesBps(2_500).amount).toBe(-13);
  });
});

describe('Money comparisons', () => {
  it('compares greater-than and less-than within the same currency', () => {
    const small = Money.fromCents(100);
    const large = Money.fromCents(200);
    expect(large.isGreaterThan(small)).toBe(true);
    expect(small.isGreaterThan(large)).toBe(false);
    expect(small.isLessThan(large)).toBe(true);
    expect(large.isLessThan(small)).toBe(false);
  });

  it('refuses to compare across currencies', () => {
    const usd = Money.fromCents(100, 'USD');
    const eur = Money.fromCents(100, 'EUR');
    expect(() => usd.isGreaterThan(eur)).toThrow(InvariantViolationError);
    expect(() => usd.isLessThan(eur)).toThrow(InvariantViolationError);
  });

  it('min returns whichever operand is lesser, in both argument orders', () => {
    const small = Money.fromCents(100);
    const large = Money.fromCents(200);
    expect(Money.min(small, large)).toBe(small);
    expect(Money.min(large, small)).toBe(small);
  });

  it('max returns whichever operand is greater, in both argument orders', () => {
    const small = Money.fromCents(100);
    const large = Money.fromCents(200);
    expect(Money.max(small, large)).toBe(large);
    expect(Money.max(large, small)).toBe(large);
  });
});

describe('Money.sum', () => {
  it('sums a list of amounts starting from zero in the given currency', () => {
    const total = Money.sum(
      [Money.fromCents(100, 'EUR'), Money.fromCents(200, 'EUR'), Money.fromCents(300, 'EUR')],
      'EUR',
    );
    expect(total.amount).toBe(600);
    expect(total.currency).toBe('EUR');
  });

  it('sums an empty list to zero in the default currency', () => {
    expect(Money.sum([]).amount).toBe(0);
    expect(Money.sum([]).currency).toBe('USD');
  });
});

describe('Money.allocate — never loses or invents a cent', () => {
  it('rejects zero parts', () => {
    expect(() => Money.fromCents(100).allocate(0)).toThrow(InvariantViolationError);
  });

  it('rejects a negative part count', () => {
    expect(() => Money.fromCents(100).allocate(-1)).toThrow(InvariantViolationError);
  });

  it('rejects a non-integer part count', () => {
    expect(() => Money.fromCents(100).allocate(2.5)).toThrow(InvariantViolationError);
  });

  it('splits a positive amount evenly when it divides exactly', () => {
    const parts = Money.fromCents(90).allocate(3);
    expect(parts.map((p) => p.amount)).toEqual([30, 30, 30]);
  });

  it('distributes a positive remainder one cent at a time from the front', () => {
    const parts = Money.fromCents(100).allocate(3);
    expect(parts.map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(Money.sum(parts).amount).toBe(100);
  });

  it('distributes a negative remainder one cent at a time from the front, preserving sign', () => {
    const parts = Money.fromCents(-100).allocate(3);
    expect(parts.map((p) => p.amount)).toEqual([-34, -33, -33]);
    expect(Money.sum(parts).amount).toBe(-100);
  });

  it('allocating into a single part returns the whole amount unchanged', () => {
    const parts = Money.fromCents(777).allocate(1);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.amount).toBe(777);
  });

  it('always sums back to the original amount, for any part count and either sign', () => {
    for (const amount of [100, -100, 7, -7, 0, 12_345]) {
      for (let parts = 1; parts <= 9; parts += 1) {
        const allocated = Money.fromCents(amount).allocate(parts);
        expect(allocated).toHaveLength(parts);
        expect(Money.sum(allocated).amount).toBe(amount);
      }
    }
  });
});

describe('Money.format and toString — §6.3', () => {
  it('formats as a locale currency string', () => {
    expect(Money.fromCents(150_000, 'USD').format()).toBe('$1,500.00');
  });

  it('formats a negative amount with a leading minus sign', () => {
    expect(Money.fromCents(-500, 'USD').format()).toBe('-$5.00');
  });

  it('toString defers to format with default options', () => {
    const money = Money.fromCents(2_500, 'USD');
    expect(money.toString()).toBe(money.format());
  });
});

// =========================================================== ValueObject.ts

interface PointProps extends Record<string, unknown> {
  readonly x: number;
  readonly y: number;
}

class Point extends ValueObject<PointProps> {
  private constructor(props: PointProps) {
    super(props);
  }
  public static of(x: number, y: number): Point {
    return new Point({ x, y });
  }
}

interface OtherPointProps extends Record<string, unknown> {
  readonly x: number;
  readonly y: number;
}

/** Structurally identical to `Point` but a distinct class — for the "different class" branch. */
class OtherPoint extends ValueObject<OtherPointProps> {
  private constructor(props: OtherPointProps) {
    super(props);
  }
  public static of(x: number, y: number): OtherPoint {
    return new OtherPoint({ x, y });
  }
}

interface FlexProps extends Record<string, unknown> {
  readonly a: number;
  readonly b?: number;
}

/** A class whose instances can legitimately carry a different number of keys. */
class Flex extends ValueObject<FlexProps> {
  public constructor(props: FlexProps) {
    super(props);
  }
}

interface AddressProps extends Record<string, unknown> {
  readonly city: string;
}

class Address extends ValueObject<AddressProps> {
  public constructor(props: AddressProps) {
    super(props);
  }
}

interface PersonProps extends Record<string, unknown> {
  readonly name: string;
  readonly address: Address;
}

class Person extends ValueObject<PersonProps> {
  public constructor(props: PersonProps) {
    super(props);
  }
}

describe('ValueObject.equals', () => {
  it('is true for two different instances carrying the same values', () => {
    expect(Point.of(1, 2).equals(Point.of(1, 2))).toBe(true);
  });

  it('is false when compared against null', () => {
    expect(Point.of(1, 2).equals(null)).toBe(false);
  });

  it('is false when compared against undefined', () => {
    expect(Point.of(1, 2).equals(undefined)).toBe(false);
  });

  it('short-circuits true on reference identity', () => {
    const point = Point.of(1, 2);
    expect(point.equals(point)).toBe(true);
  });

  it('is false when the other value is a different class with the same shape', () => {
    const point = Point.of(1, 2);
    const other = OtherPoint.of(1, 2) as unknown as Point;
    expect(point.equals(other)).toBe(false);
  });

  it('is false when the two instances have a different number of keys', () => {
    const withOptional = new Flex({ a: 1, b: 2 });
    const withoutOptional = new Flex({ a: 1 });
    expect(withOptional.equals(withoutOptional)).toBe(false);
    expect(withoutOptional.equals(withOptional)).toBe(false);
  });

  it('compares a nested value object through its own equals when values match', () => {
    const p1 = new Person({ name: 'Ada', address: new Address({ city: 'NYC' }) });
    const p2 = new Person({ name: 'Ada', address: new Address({ city: 'NYC' }) });
    expect(p1.equals(p2)).toBe(true);
  });

  it('compares a nested value object through its own equals when values differ', () => {
    const p1 = new Person({ name: 'Ada', address: new Address({ city: 'NYC' }) });
    const p3 = new Person({ name: 'Ada', address: new Address({ city: 'LA' }) });
    expect(p1.equals(p3)).toBe(false);
  });

  it('exposes a stable structural snapshot via toJSON', () => {
    expect(Point.of(1, 2).toJSON()).toEqual({ x: 1, y: 2 });
  });
});

// ================================================================ Entity.ts

class TestEntity extends Entity<string> {
  public constructor(id: string) {
    super(id);
  }
}

describe('Entity.equals', () => {
  it('is true for two different instances sharing the same id', () => {
    expect(new TestEntity('booking-1').equals(new TestEntity('booking-1'))).toBe(true);
  });

  it('is true for reference identity', () => {
    const entity = new TestEntity('booking-1');
    expect(entity.equals(entity)).toBe(true);
  });

  it('is false for two instances with different ids', () => {
    expect(new TestEntity('booking-1').equals(new TestEntity('booking-2'))).toBe(false);
  });

  it('is false when compared against null or undefined', () => {
    const entity = new TestEntity('booking-1');
    expect(entity.equals(null)).toBe(false);
    expect(entity.equals(undefined)).toBe(false);
  });

  it('is false when the other value is not an Entity at all', () => {
    const entity = new TestEntity('booking-1');
    const notAnEntity = { id: 'booking-1' } as unknown as Entity<string>;
    expect(entity.equals(notAnEntity)).toBe(false);
  });
});

// =========================================================== AggregateRoot.ts

class TestAggregate extends AggregateRoot<string> {
  public constructor(id: string) {
    super(id);
  }
  public emit(event: DomainEvent): void {
    this.recordEvent(event);
  }
}

describe('AggregateRoot event buffering', () => {
  it('starts with no pending events', () => {
    const aggregate = new TestAggregate('claim-1');
    expect(aggregate.pendingEvents).toHaveLength(0);
  });

  it('pendingEvents peeks the buffer without draining it', () => {
    const aggregate = new TestAggregate('claim-1');
    const event = domainEvent('claim.created', 'claim-1', new Date());
    aggregate.emit(event);

    expect(aggregate.pendingEvents).toEqual([event]);
    // Peeking twice must not drain — the buffer is still there.
    expect(aggregate.pendingEvents).toEqual([event]);
  });

  it('pullDomainEvents returns the recorded events and clears the buffer', () => {
    const aggregate = new TestAggregate('claim-1');
    const first = domainEvent('claim.created', 'claim-1', new Date());
    const second = domainEvent('claim.expired', 'claim-1', new Date());
    aggregate.emit(first);
    aggregate.emit(second);

    expect(aggregate.pullDomainEvents()).toEqual([first, second]);
  });

  it('a second pull after draining returns no events, so a caller cannot double-dispatch', () => {
    const aggregate = new TestAggregate('claim-1');
    aggregate.emit(domainEvent('claim.created', 'claim-1', new Date()));
    aggregate.pullDomainEvents();

    expect(aggregate.pullDomainEvents()).toHaveLength(0);
    expect(aggregate.pendingEvents).toHaveLength(0);
  });
});

// ============================================================= DomainEvent.ts

describe('domainEvent factory', () => {
  it('builds a frozen event with the given type, aggregate id, timestamp and payload', () => {
    const occurredAt = new Date('2026-01-01T00:00:00Z');
    const event = domainEvent('booking.recorded', 'booking-1', occurredAt, { amount: 100 });

    expect(event).toEqual({
      type: 'booking.recorded',
      aggregateId: 'booking-1',
      occurredAt,
      payload: { amount: 100 },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });

  it('defaults to an empty payload when none is given', () => {
    const event = domainEvent('booking.recorded', 'booking-1', new Date());
    expect(event.payload).toEqual({});
  });
});

// ============================================================= DomainError.ts

describe('DomainError', () => {
  it('carries a code, message and frozen details', () => {
    const error = new DomainError('SOME_CODE', 'Something went wrong.', { field: 'x' });
    expect(error.code).toBe('SOME_CODE');
    expect(error.message).toBe('Something went wrong.');
    expect(error.name).toBe('DomainError');
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('defaults details to a frozen empty object', () => {
    const error = new DomainError('SOME_CODE', 'Something went wrong.');
    expect(error.details).toEqual({});
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('freezes details so a caller cannot mutate them after construction', () => {
    const error = new DomainError('SOME_CODE', 'msg', { field: 'x' });
    const details = error.details as Record<string, unknown>;
    expect(() => {
      details.extra = 'value';
    }).toThrow(TypeError);
  });

  it('is an instanceof Error and DomainError, with the prototype chain explicitly restored', () => {
    const error = new DomainError('SOME_CODE', 'msg');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(Object.getPrototypeOf(error)).toBe(DomainError.prototype);
  });
});

describe('InvalidTransitionError', () => {
  it('formats a code and message describing the forbidden transition', () => {
    const error = new InvalidTransitionError('Claim', 'EXPIRED', 'FILED');
    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.message).toBe('Claim cannot move from EXPIRED to FILED.');
    expect(error.name).toBe('InvalidTransitionError');
  });

  it('carries the aggregate, from and to states as frozen details', () => {
    const error = new InvalidTransitionError('Claim', 'EXPIRED', 'FILED');
    expect(error.details).toEqual({ aggregate: 'Claim', from: 'EXPIRED', to: 'FILED' });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('is an instanceof Error, DomainError and InvalidTransitionError, with the chain restored', () => {
    const error = new InvalidTransitionError('Claim', 'EXPIRED', 'FILED');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect(Object.getPrototypeOf(error)).toBe(InvalidTransitionError.prototype);
  });
});

describe('InvariantViolationError', () => {
  it('carries the given message and details verbatim', () => {
    const error = new InvariantViolationError('Amount must be an integer.', { amount: 10.5 });
    expect(error.code).toBe('INVARIANT_VIOLATION');
    expect(error.message).toBe('Amount must be an integer.');
    expect(error.name).toBe('InvariantViolationError');
    expect(error.details).toEqual({ amount: 10.5 });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('is an instanceof Error, DomainError and InvariantViolationError, with the chain restored', () => {
    const error = new InvariantViolationError('bad value');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(InvariantViolationError);
    expect(Object.getPrototypeOf(error)).toBe(InvariantViolationError.prototype);
  });
});

// =================================================================== Clock.ts

describe('SystemClock', () => {
  it('returns a Date close to the real current time', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    const after = Date.now();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('FixedClock', () => {
  it('starts at the given instant and returns a defensive copy on now()', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const clock = new FixedClock(start);
    expect(clock.now()).toEqual(start);
    expect(clock.now()).not.toBe(start);
  });

  it('throws RangeError when constructed from an invalid instant', () => {
    expect(() => new FixedClock('not-a-real-date')).toThrow(RangeError);
  });

  it('advanceMs moves the clock forward by the given number of milliseconds', () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    clock.advanceMs(1_500);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.500Z');
  });

  it('advanceHours moves the clock forward by whole hours', () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    clock.advanceHours(24);
    expect(clock.now().toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('advanceDays moves the clock forward by whole days', () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    clock.advanceDays(2);
    expect(clock.now().toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });

  it('set jumps the clock directly to a new instant', () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    clock.set('2027-06-15T12:00:00Z');
    expect(clock.now().toISOString()).toBe('2027-06-15T12:00:00.000Z');
  });

  it('advance calls are chainable', () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    const result = clock.advanceHours(1).advanceDays(1).set('2026-02-01T00:00:00Z');
    expect(result).toBe(clock);
  });
});

describe('addHours and addDays — §3 pure arithmetic, no ambient clock', () => {
  it('adds hours as a physical duration', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(addHours(start, 5).getTime() - start.getTime()).toBe(5 * MS_PER_HOUR);
  });

  it('adds days as a physical duration', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(addDays(start, 3).getTime() - start.getTime()).toBe(3 * MS_PER_DAY);
  });

  it('addHours(t, 24) is exactly 24 real hours later even across a US DST spring-forward — §10.2', () => {
    // 2026-03-08 is the date US clocks spring forward. The 24-hour price-match
    // claim window (§13.3) is the highest-stakes time math in the app: it must
    // be measured as a physical duration off the epoch, never recomputed via
    // local calendar fields, or a claim filed right before the transition would
    // appear to have a 23-hour window instead of 24.
    const bookedAt = new Date('2026-03-08T05:00:00Z');
    const deadline = addHours(bookedAt, 24);

    expect(deadline.getTime() - bookedAt.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(deadline.toISOString()).toBe('2026-03-09T05:00:00.000Z');
  });
});

describe('daysBetween', () => {
  it('truncates a positive fractional difference toward zero, not down', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-02T12:00:00Z'); // 1.5 days later
    expect(daysBetween(from, to)).toBe(1);
  });

  it('truncates a negative fractional difference toward zero, not further negative', () => {
    const from = new Date('2026-01-02T12:00:00Z');
    const to = new Date('2026-01-01T00:00:00Z'); // -1.5 days later
    expect(daysBetween(from, to)).toBe(-1);
  });

  it('is zero for two equal instants', () => {
    const instant = new Date('2026-01-01T00:00:00Z');
    expect(daysBetween(instant, instant)).toBe(0);
  });
});

describe('msUntil', () => {
  it('returns the exact millisecond gap to a future deadline', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const deadline = new Date('2026-01-01T01:00:00Z');
    expect(msUntil(now, deadline)).toBe(MS_PER_HOUR);
  });

  it('floors at zero once the deadline has passed, rather than going negative', () => {
    const now = new Date('2026-01-01T01:00:00Z');
    const deadline = new Date('2026-01-01T00:00:00Z');
    expect(msUntil(now, deadline)).toBe(0);
  });

  it('is zero exactly at the deadline', () => {
    const instant = new Date('2026-01-01T00:00:00Z');
    expect(msUntil(instant, instant)).toBe(0);
  });
});

// ================================================================== Result.ts

describe('ok / err / isOk / isErr', () => {
  it('ok wraps a success value that isOk recognises and isErr rejects', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('err wraps a failure that isErr recognises and isOk rejects', () => {
    const result = err('bad input');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    expect(result).toEqual({ ok: false, error: 'bad input' });
  });
});

describe('mapResult', () => {
  it('transforms the value inside a success result', () => {
    const mapped = mapResult(ok(2), (n) => n * 10);
    expect(mapped).toEqual({ ok: true, value: 20 });
  });

  it('passes a failure result through unchanged', () => {
    const original = err('bad input');
    const mapped = mapResult(original, (n: number) => n * 10);
    expect(mapped).toBe(original);
  });
});

describe('unwrap', () => {
  it('returns the value of a success result', () => {
    expect(unwrap(ok('value'))).toBe('value');
  });

  it('throws the error of a failure result when it is already an Error', () => {
    const original = new Error('boom');
    expect(() => unwrap(err(original))).toThrow(original);
  });

  it('wraps a non-Error failure value in a new Error', () => {
    expect(() => unwrap(err('plain string failure'))).toThrow('plain string failure');
    try {
      unwrap(err({ reason: 'nope' }));
      expect.unreachable('unwrap should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe('[object Object]');
    }
  });
});
