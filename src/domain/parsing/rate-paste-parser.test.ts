import { describe, it, expect } from 'vitest';
import {
  parseMoneyToCents,
  parseDate,
  nightsBetween,
  parseRatePaste,
  isParseUseful,
} from './rate-paste-parser';

/**
 * §13.3 names input friction as "the existential risk" and makes the paste
 * parser required, not optional. §1.4 forbids an LLM anywhere in a numeric
 * path, so every one of these behaviours is a regex the tests pin down.
 *
 * The parser's governing rule (DECISIONS.md D-061) is that an unparsed field
 * stays empty rather than being guessed — a wrong number the user does not
 * notice is far worse than a blank one they have to fill in. Most of these
 * tests are about *refusing* to parse.
 */

describe('parseMoneyToCents — §3.1, never a float', () => {
  it.each([
    ['1234', 123_400],
    ['1,234', 123_400],
    ['$1,234.50', 123_450],
    ['1234.5', 123_450],
    ['USD 1,234.50', 123_450],
    ['$0.07', 7],
    ['0.01', 1],
    ['3,540.00', 354_000],
  ])('parses %s to %i cents', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it('does not drift through float error on values that break parseFloat', () => {
    // 19.99 * 100 === 1998.9999999999998 in IEEE-754. String assembly avoids it.
    expect(parseMoneyToCents('19.99')).toBe(1999);
    expect(parseMoneyToCents('0.29')).toBe(29);
  });

  it('reads a three-digit tail as a thousands group, not as three decimals', () => {
    // "1.005" is European grouping for one thousand and five; no currency has
    // three minor digits, so a three-digit tail is never a fractional part.
    expect(parseMoneyToCents('1.005')).toBe(100_500);
    expect(parseMoneyToCents('1,005')).toBe(100_500);
  });

  it('refuses a tail that is neither a group nor a minor unit', () => {
    expect(parseMoneyToCents('1.2345')).toBeNull();
  });

  it('treats a zero-decimal currency as having no minor unit', () => {
    // ¥40,000 is forty thousand yen, not four hundred. Getting this wrong would
    // understate a Tokyo stay by a factor of a hundred.
    expect(parseMoneyToCents('40,000', 'JPY')).toBe(40_000);
    expect(parseMoneyToCents('¥40,000', 'JPY')).toBe(40_000);
    expect(parseMoneyToCents('40000.50', 'JPY')).toBeNull();
  });

  it('handles a negative amount', () => {
    expect(parseMoneyToCents('-$50.00')).toBe(-5_000);
  });

  it('returns null on anything ambiguous rather than guessing', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('1.2345')).toBeNull();
  });
});

describe('parseDate', () => {
  it.each([
    ['2026-09-01', '2026-09-01'],
    ['Sep 1, 2026', '2026-09-01'],
    ['September 1 2026', '2026-09-01'],
    ['1 September 2026', '2026-09-01'],
    ['Sept 15, 2026', '2026-09-15'],
    ['31 December 2026', '2026-12-31'],
  ])('parses %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('uses an assumed year when the paste omits one', () => {
    expect(parseDate('Sep 1', 2026)).toBe('2026-09-01');
    expect(parseDate('Sep 1')).toBeNull();
  });

  it('resolves a numeric date only when the order is unambiguous', () => {
    expect(parseDate('25/12/2026')).toBe('2026-12-25'); // 25 cannot be a month
    expect(parseDate('12/25/2026')).toBe('2026-12-25'); // 25 cannot be a month
  });

  it('refuses a genuinely ambiguous numeric date', () => {
    // 01/09/2026 is 1 September to half the world and 9 January to the other
    // half. A silently wrong check-in breaks PM8's parameter match, which is
    // the whole claim.
    expect(parseDate('01/09/2026')).toBeNull();
    expect(parseDate('05/06/2026')).toBeNull();
  });

  it('returns null on junk', () => {
    expect(parseDate('tomorrow')).toBeNull();
    expect(parseDate('Smarch 3, 2026')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('nightsBetween', () => {
  it('counts whole nights', () => {
    expect(nightsBetween('2026-09-01', '2026-09-04')).toBe(3);
    expect(nightsBetween('2026-09-01', '2026-09-02')).toBe(1);
  });

  it('spans a month and a year boundary correctly', () => {
    expect(nightsBetween('2026-08-30', '2026-09-02')).toBe(3);
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('refuses a zero-night or reversed range', () => {
    expect(nightsBetween('2026-09-01', '2026-09-01')).toBeNull();
    expect(nightsBetween('2026-09-04', '2026-09-01')).toBeNull();
  });
});

describe('parseRatePaste — a realistic Edit block', () => {
  const paste = `
The Edit by Chase Travel
Four Seasons Hotel Tokyo at Otemachi
Check-in: September 1, 2026
Check-out: September 4, 2026
3 nights
Room: Deluxe King Room
Room rate: $3,149.47
Taxes and fees: $390.53
Total: $3,540.00
Free cancellation until August 28, 2026
  `;

  const parsed = parseRatePaste(paste);

  it('extracts the total, which is the one field the engine cannot do without', () => {
    expect(parsed.totalCents?.value).toBe(354_000);
    expect(parsed.totalCents?.confidence).toBe('high');
  });

  it('extracts the base rate and tax separately', () => {
    expect(parsed.baseCents?.value).toBe(314_947);
    expect(parsed.taxCents?.value).toBe(39_053);
  });

  it('extracts both dates and the night count', () => {
    expect(parsed.checkIn?.value).toBe('2026-09-01');
    expect(parsed.checkOut?.value).toBe('2026-09-04');
    expect(parsed.nights?.value).toBe(3);
  });

  it('extracts room and bed type for the PM8 parameter match', () => {
    expect(parsed.roomType?.value).toBe('Deluxe King Room');
    expect(parsed.bedType?.value).toBe('King');
  });

  it('reads the cancellation policy as refundable', () => {
    expect(parsed.refundable?.value).toBe(true);
  });

  it('reports nothing missing on a complete block', () => {
    expect(parsed.missing).toEqual([]);
  });

  it('keeps the matched text so the confirmation view can show its work', () => {
    expect(parsed.totalCents?.matchedText).toContain('3,540.00');
  });

  it('reconstructs the tax rate the engine needs', () => {
    // base 314947 + tax 39053 = total 354000, and 39053/314947 ≈ 12.40% — the
    // rate TC-01 uses. The parser feeds the calculator, not the engine directly.
    const base = parsed.baseCents?.value ?? 0;
    const tax = parsed.taxCents?.value ?? 0;
    expect(base + tax).toBe(parsed.totalCents?.value);
    expect(Math.round((tax / base) * 10_000)).toBe(1240);
  });
});

describe('parseRatePaste — cancellation policy is the highest-stakes field', () => {
  it('reads an explicit non-refundable rate', () => {
    const parsed = parseRatePaste('Total: $500.00\nNon-refundable');
    expect(parsed.refundable?.value).toBe(false);
    expect(parsed.refundable?.confidence).toBe('high');
  });

  it('reads an advance-purchase rate as non-refundable', () => {
    expect(parseRatePaste('Total: $500\nAdvance Purchase rate').refundable?.value).toBe(false);
  });

  it('prefers the non-refundable reading when a block says both', () => {
    // "Free cancellation until 1 Sep, non-refundable thereafter" is a rate that
    // will be non-refundable by the time it matters. §2.3.3 makes a
    // cancellation mismatch the universal denial cause, so we take the
    // pessimistic reading.
    const parsed = parseRatePaste(
      'Total: $500\nFree cancellation until Sep 1, non-refundable thereafter',
    );
    expect(parsed.refundable?.value).toBe(false);
  });

  it('leaves the policy null when the block does not state one', () => {
    const parsed = parseRatePaste('Total: $500.00');
    expect(parsed.refundable).toBeNull();
    expect(parsed.missing).toContain('cancellation policy');
  });
});

describe('parseRatePaste — currency', () => {
  it('detects an ISO code with high confidence', () => {
    const parsed = parseRatePaste('Total: USD 1,234.50');
    expect(parsed.currency?.value).toBe('USD');
    expect(parsed.currency?.confidence).toBe('high');
  });

  it('detects a symbol with lower confidence', () => {
    const parsed = parseRatePaste('Total: £1,234.50');
    expect(parsed.currency?.value).toBe('GBP');
    expect(parsed.currency?.confidence).toBe('medium');
  });

  it('applies the zero-decimal rule to a yen block', () => {
    const parsed = parseRatePaste('Total: ¥120,000\n3 nights');
    expect(parsed.currency?.value).toBe('JPY');
    expect(parsed.totalCents?.value).toBe(120_000);
  });
});

describe('parseRatePaste — refuses to guess', () => {
  it('lists every field it could not find', () => {
    const parsed = parseRatePaste('Some hotel, sometime, some price');
    expect(parsed.missing).toEqual(
      expect.arrayContaining(['total', 'base rate', 'check-in', 'check-out', 'nights']),
    );
  });

  it('returns nulls rather than zeroes for missing money', () => {
    // A zero total would rank as a free hotel room and win every comparison.
    const parsed = parseRatePaste('Check-in: September 1, 2026');
    expect(parsed.totalCents).toBeNull();
    expect(parsed.baseCents).toBeNull();
  });

  it('derives nights from dates but marks the lower confidence', () => {
    const parsed = parseRatePaste(
      'Total: $500\nCheck-in: September 1, 2026\nCheck-out: September 4, 2026',
    );
    expect(parsed.nights?.value).toBe(3);
    expect(parsed.nights?.confidence).toBe('medium');
  });

  it('prefers a stated night count over a derived one', () => {
    const parsed = parseRatePaste(
      'Total: $500\n2 nights\nCheck-in: September 1, 2026\nCheck-out: September 4, 2026',
    );
    expect(parsed.nights?.value).toBe(2);
    expect(parsed.nights?.confidence).toBe('high');
  });

  it('handles an empty paste without throwing', () => {
    const parsed = parseRatePaste('');
    expect(parsed.totalCents).toBeNull();
    expect(isParseUseful(parsed)).toBe(false);
  });
});

describe('isParseUseful — the gate on showing a confirmation at all', () => {
  it('is useful once any money was found', () => {
    expect(isParseUseful(parseRatePaste('Total: $500.00'))).toBe(true);
    expect(isParseUseful(parseRatePaste('Room rate: $400.00'))).toBe(true);
  });

  it('is not useful for a block that yielded only a currency symbol', () => {
    // Offering this for confirmation trains the user to click through the
    // confirmation step, which is the step that makes the feature safe.
    expect(isParseUseful(parseRatePaste('Prices shown in $'))).toBe(false);
  });
});

/**
 * The branches a realistic paste does not happen to exercise. Untested
 * branches in money parsing are precisely where a wrong number hides, so
 * these close the gap rather than leaving it to chance.
 */
describe('parser edge branches', () => {
  it('handles a negative amount in a zero-decimal currency', () => {
    expect(parseMoneyToCents('-¥40,000', 'JPY')).toBe(-40_000);
  });

  it('rejects a whole part that is not all digits after cleaning', () => {
    expect(parseMoneyToCents('..')).toBeNull();
    expect(parseMoneyToCents(',')).toBeNull();
  });

  it('rejects an amount too large to hold exactly as an integer', () => {
    expect(parseMoneyToCents('99999999999999999999.99')).toBeNull();
  });

  it('falls through when a label matches but the value is unparseable', () => {
    // The pattern fires on "Total:" but "sold out" is not money, so the field
    // stays missing rather than becoming a zero.
    const parsed = parseRatePaste('Total: sold out');
    expect(parsed.totalCents).toBeNull();
    expect(parsed.missing).toContain('total');
  });

  it('falls through when a date label matches but the date is unparseable', () => {
    const parsed = parseRatePaste('Total: $500\nCheck-in: whenever you like');
    expect(parsed.checkIn).toBeNull();
    expect(parsed.missing).toContain('check-in');
  });

  it('normalises the bed descriptions that need special casing', () => {
    expect(parseRatePaste('Total: $1\nTwo doubles').bedType?.value).toBe('Two doubles');
    expect(parseRatePaste('Total: $1\nDouble bed').bedType?.value).toBe('Double');
    expect(parseRatePaste('Total: $1\nqueen').bedType?.value).toBe('Queen');
    expect(parseRatePaste('Total: $1\nSofa bed').bedType?.value).toBe('Sofa bed');
  });

  it('resolves a month-first date without a year using the assumed year', () => {
    expect(parseRatePaste('Total: $1\nCheck-in: Sep 1', 2026).checkIn?.value).toBe('2026-09-01');
  });

  it('resolves a day-first date without a year using the assumed year', () => {
    expect(parseRatePaste('Total: $1\nCheck-in: 1 September', 2026).checkIn?.value).toBe(
      '2026-09-01',
    );
  });

  it('rejects an out-of-range day rather than rolling it into the next month', () => {
    expect(parseDate('Feb 40, 2026')).toBeNull();
    expect(parseDate('0 September 2026')).toBeNull();
  });

  it('leaves nights unset when the dates are reversed', () => {
    const parsed = parseRatePaste(
      'Total: $500\nCheck-in: September 4, 2026\nCheck-out: September 1, 2026',
    );
    expect(parsed.nights).toBeNull();
    expect(parsed.missing).toContain('nights');
  });

  it('detects each supported currency symbol', () => {
    expect(parseRatePaste('Total: €500').currency?.value).toBe('EUR');
    expect(parseRatePaste('Total: £500').currency?.value).toBe('GBP');
    expect(parseRatePaste('Total: $500').currency?.value).toBe('USD');
  });

  it('leaves the currency unset when the paste names none', () => {
    expect(parseRatePaste('Total: 500.00').currency).toBeNull();
  });
});

describe('the parser never reaches the engine on its own', () => {
  it('returns plain data with no engine or persistence coupling', () => {
    const parsed = parseRatePaste('Total: $3,540.00');
    // §13.3: "always show the parsed result for confirmation before it touches
    // the engine." The parser's output is inert — fields, confidences and the
    // matched text, with no method that could apply itself anywhere.
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'baseCents',
        'bedType',
        'checkIn',
        'checkOut',
        'currency',
        'missing',
        'nights',
        'refundable',
        'roomType',
        'source',
        'taxCents',
        'totalCents',
      ].sort(),
    );
  });
});
