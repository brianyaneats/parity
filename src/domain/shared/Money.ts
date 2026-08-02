import { ValueObject } from './ValueObject';
import { InvariantViolationError } from './DomainError';
import { type Cents, cents, roundHalfAwayFromZero, BPS_SCALE } from './cents';

interface MoneyProps extends Record<string, unknown> {
  readonly amount: Cents;
  readonly currency: string;
}

/**
 * `Money` — the ergonomic value object, DECISIONS.md D-031.
 *
 * The engine's hot path uses the branded `Cents` primitive from `./cents`
 * because §3.1 requires it and because a branded number allocates nothing.
 * A branded number cannot carry behaviour, though, so the application and UI
 * layers use this instead: immutable, currency-aware, and impossible to add to
 * a different currency by accident.
 *
 * `Money.toCents()` is the single bridge between the two representations.
 */
export class Money extends ValueObject<MoneyProps> {
  private constructor(props: MoneyProps) {
    super(props);
  }

  public static fromCents(amount: number, currency = 'USD'): Money {
    if (!Number.isInteger(amount)) {
      throw new InvariantViolationError('Money must be constructed from integer cents.', {
        amount,
      });
    }
    return new Money({ amount: amount as Cents, currency: Money.normaliseCurrency(currency) });
  }

  /**
   * Parses a user-facing dollar figure. The only place a float is permitted to
   * exist, and it is converted immediately — §3.1's "never let a float past the
   * input layer".
   */
  public static fromDollars(amount: number, currency = 'USD'): Money {
    if (!Number.isFinite(amount)) {
      throw new InvariantViolationError('Money requires a finite amount.', { amount });
    }
    return new Money({
      amount: cents(amount * 100),
      currency: Money.normaliseCurrency(currency),
    });
  }

  public static zero(currency = 'USD'): Money {
    return Money.fromCents(0, currency);
  }

  private static normaliseCurrency(currency: string): string {
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new InvariantViolationError('Currency must be a 3-letter ISO code.', { currency });
    }
    return code;
  }

  public get amount(): Cents {
    return this.props.amount;
  }

  public get currency(): string {
    return this.props.currency;
  }

  public toCents(): Cents {
    return this.props.amount;
  }

  public get isZero(): boolean {
    return this.props.amount === 0;
  }

  public get isNegative(): boolean {
    return this.props.amount < 0;
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (other.currency !== this.currency) {
      throw new InvariantViolationError(
        `Cannot ${operation} ${other.currency} and ${this.currency}.`,
        { left: this.currency, right: other.currency },
      );
    }
  }

  public plus(other: Money): Money {
    this.assertSameCurrency(other, 'add');
    return Money.fromCents(this.props.amount + other.amount, this.currency);
  }

  public minus(other: Money): Money {
    this.assertSameCurrency(other, 'subtract');
    return Money.fromCents(this.props.amount - other.amount, this.currency);
  }

  public negated(): Money {
    return Money.fromCents(-this.props.amount, this.currency);
  }

  public abs(): Money {
    return Money.fromCents(Math.abs(this.props.amount), this.currency);
  }

  /** Multiplies by a basis-point rate. `1240` → 12.40%. */
  public timesBps(rate: number): Money {
    return Money.fromCents(
      roundHalfAwayFromZero((this.props.amount * rate) / BPS_SCALE),
      this.currency,
    );
  }

  public isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other, 'compare');
    return this.props.amount > other.amount;
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other, 'compare');
    return this.props.amount < other.amount;
  }

  public static min(a: Money, b: Money): Money {
    return a.isLessThan(b) ? a : b;
  }

  public static max(a: Money, b: Money): Money {
    return a.isGreaterThan(b) ? a : b;
  }

  public static sum(values: readonly Money[], currency = 'USD'): Money {
    return values.reduce<Money>((acc, value) => acc.plus(value), Money.zero(currency));
  }

  /**
   * Splits an amount across `parts` without losing or inventing a cent. The
   * remainder is distributed one cent at a time from the front, so the parts
   * always sum back to the original exactly.
   */
  public allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) {
      throw new InvariantViolationError('Allocation requires at least one part.', { parts });
    }
    const sign = this.props.amount < 0 ? -1 : 1;
    const magnitude = Math.abs(this.props.amount);
    const share = Math.floor(magnitude / parts);
    let remainder = magnitude - share * parts;

    return Array.from({ length: parts }, () => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return Money.fromCents(sign * (share + extra), this.currency);
    });
  }

  /**
   * Formats for display. §6.3 requires currency formatting to happen only at
   * the render layer — this method is that layer's helper, and nothing in the
   * domain calls it.
   */
  public format(locale = 'en-US', options: Intl.NumberFormatOptions = {}): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      ...options,
    }).format(this.props.amount / 100);
  }

  public override toString(): string {
    return this.format();
  }
}
