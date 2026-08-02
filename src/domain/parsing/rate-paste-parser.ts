/**
 * The paste parser — §13.3.
 *
 * "**Input friction is the existential risk.** The engine can be flawless and
 * the app still dies because entering six rates on a phone before booking is
 * too much work." Two mitigations are named as *required, not optional*, and
 * this is the second: a textarea where the user pastes a copied rate block, and
 * a deterministic parser that extracts what it can.
 *
 * Three constraints, all binding:
 *
 * 1. **Regex and explicit patterns, never an LLM.** §1.4: "If you add an LLM
 *    call anywhere that affects a number the user sees, you have broken the
 *    product." A parser feeding the engine is squarely a numeric path.
 * 2. **Always show the parsed result for confirmation before it touches the
 *    engine.** The parser returns a `ParsedRate` with per-field confidence and
 *    the raw matched text; the UI renders that for review. Nothing here writes
 *    to a comparison.
 * 3. **An unparsed field stays empty rather than being guessed.** A wrong
 *    number the user does not notice is far worse than a blank one they have to
 *    fill in — DECISIONS.md D-061.
 */

export type ParseConfidence = 'high' | 'medium' | 'low';

export interface ParsedField<T> {
  readonly value: T;
  readonly confidence: ParseConfidence;
  /** The substring this came from, so the UI can show its work. */
  readonly matchedText: string;
}

export interface ParsedRate {
  /** Total including tax, in integer cents. */
  readonly totalCents: ParsedField<number> | null;
  /** Base rate excluding tax, in integer cents. */
  readonly baseCents: ParsedField<number> | null;
  readonly taxCents: ParsedField<number> | null;
  readonly nights: ParsedField<number> | null;
  readonly checkIn: ParsedField<string> | null;
  readonly checkOut: ParsedField<string> | null;
  readonly roomType: ParsedField<string> | null;
  readonly bedType: ParsedField<string> | null;
  readonly refundable: ParsedField<boolean> | null;
  readonly currency: ParsedField<string> | null;
  /** Fields the parser could not find. Rendered as "you'll need to enter this". */
  readonly missing: readonly string[];
  /** Everything the parser matched, for the confirmation view. */
  readonly source: string;
}

/* -------------------------------------------------------------- currency */

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '¥': 'JPY',
});

/** Currencies with no minor unit — a "¥40,000" total is 40000 yen, not 400.00. */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = Object.freeze(new Set(['JPY', 'KRW']));

/**
 * Parses a money string to integer cents (or to the currency's minor unit).
 *
 * Handles `1234`, `1,234`, `$1,234.50`, `1234.5`, `USD 1,234.50`, `¥40,000`.
 * Returns null rather than guessing on anything ambiguous.
 *
 * The string is split on the decimal point and reassembled by string
 * manipulation rather than `parseFloat(...) * 100`, because `19.99 * 100` is
 * `1998.9999999999998` and §3.1 forbids a float touching money at all.
 */
export function parseMoneyToCents(input: string, currency = 'USD'): number | null {
  const cleaned = input.replace(/[^0-9.,-]/g, '').trim();
  if (cleaned.length === 0) return null;

  const negative = cleaned.startsWith('-');
  const digits = cleaned.replace(/-/g, '');

  // Distinguish a thousands separator from a decimal separator. A comma or dot
  // followed by exactly three digits, with more separators before it, is a
  // grouping mark; two trailing digits after the last separator is a decimal.
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  const lastSeparator = Math.max(lastDot, lastComma);

  let wholePart: string;
  let fractionPart: string;

  if (lastSeparator === -1) {
    wholePart = digits;
    fractionPart = '';
  } else {
    const tail = digits.slice(lastSeparator + 1);
    if (tail.length === 3 && /^\d{3}$/.test(tail)) {
      // Grouping, e.g. "1,234" or "40,000" — no fractional part at all.
      wholePart = digits.replace(/[.,]/g, '');
      fractionPart = '';
    } else if (/^\d{1,2}$/.test(tail)) {
      wholePart = digits.slice(0, lastSeparator).replace(/[.,]/g, '');
      fractionPart = tail;
    } else {
      return null;
    }
  }

  if (!/^\d+$/.test(wholePart)) return null;

  if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
    // No minor unit: the whole number IS the amount.
    if (fractionPart.length > 0) return null;
    const value = Number(wholePart);
    return Number.isSafeInteger(value) ? (negative ? -value : value) : null;
  }

  const minor = fractionPart.padEnd(2, '0').slice(0, 2);
  const value = Number(`${wholePart}${minor}`);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/* ---------------------------------------------------------------- dates */

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
});

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Parses a date to `YYYY-MM-DD`.
 *
 * Accepts ISO (`2026-09-01`), `Sep 1, 2026`, `1 September 2026`, and
 * `09/01/2026`. **A bare `01/09/2026` is refused**, because it is 1 September
 * to half the world and 9 January to the other half — and a silently wrong
 * check-in date breaks the parameter match that a whole price-match claim
 * depends on (§2.3.1 PM8).
 */
export function parseDate(input: string, assumeYear?: number): string | null {
  const text = input.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "Sep 1, 2026" / "September 1 2026"
  const monthFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/.exec(text);
  if (monthFirst) {
    const month = MONTHS[(monthFirst[1] ?? '').toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = monthFirst[3] ? Number(monthFirst[3]) : assumeYear;
    if (month && day >= 1 && day <= 31 && year) return `${year}-${pad(month)}-${pad(day)}`;
  }

  // "1 September 2026"
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?$/.exec(text);
  if (dayFirst) {
    const month = MONTHS[(dayFirst[2] ?? '').toLowerCase()];
    const day = Number(dayFirst[1]);
    const year = dayFirst[3] ? Number(dayFirst[3]) : assumeYear;
    if (month && day >= 1 && day <= 31 && year) return `${year}-${pad(month)}-${pad(day)}`;
  }

  // Numeric slashes are only safe when the first field cannot be a month.
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (first > 12 && second <= 12) return `${year}-${pad(second)}-${pad(first)}`; // D/M/Y
    if (second > 12 && first <= 12) return `${year}-${pad(first)}-${pad(second)}`; // M/D/Y
    // Genuinely ambiguous — refuse rather than pick.
    return null;
  }

  return null;
}

/** Whole nights between two `YYYY-MM-DD` dates. */
export function nightsBetween(checkIn: string, checkOut: string): number | null {
  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null;
  return Math.round((to - from) / 86_400_000);
}

/* --------------------------------------------------------------- parser */

const field = <T>(
  value: T,
  confidence: ParseConfidence,
  matchedText: string,
): ParsedField<T> => ({ value, confidence, matchedText });

/**
 * Extracts what it can from a pasted rate block.
 *
 * Every pattern is explicit and every failure is silent-but-visible: an
 * unmatched field lands in `missing` so the confirmation view can say "you'll
 * need to enter this" rather than showing a plausible wrong number.
 */
export function parseRatePaste(input: string, assumeYear?: number): ParsedRate {
  const source = input.trim();
  const missing: string[] = [];

  // ---- currency, first: it changes how money is parsed (¥40,000 ≠ $400.00)
  let currency: ParsedField<string> | null = null;
  const isoCurrency = /\b(USD|GBP|EUR|JPY|CAD|AUD|CHF|SGD|HKD)\b/.exec(source);
  if (isoCurrency?.[1]) {
    currency = field(isoCurrency[1], 'high', isoCurrency[0]);
  } else {
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (source.includes(symbol)) {
        currency = field(code, 'medium', symbol);
        break;
      }
    }
  }
  const currencyCode = currency?.value ?? 'USD';

  // ---- money. Labelled amounts are high confidence; a bare figure is not.
  const totalCents = matchMoney(
    source,
    currencyCode,
    [
      /(?:total|total\s+price|amount\s+due|order\s+total|trip\s+total|grand\s+total)\s*(?:for\s+stay)?\s*[:\s]\s*([^\n]+)/i,
      /([^\n]+?)\s*(?:total\s+including\s+taxes)/i,
    ],
  );
  const baseCents = matchMoney(source, currencyCode, [
    /(?:room\s+rate|base\s+rate|subtotal|rate\s+per\s+night|nightly\s+rate|room\s+charge)\s*[:\s]\s*([^\n]+)/i,
  ]);
  const taxCents = matchMoney(source, currencyCode, [
    /(?:taxes?\s*(?:and|&)\s*fees?|taxes?|fees?\s*and\s*taxes?)\s*[:\s]\s*([^\n]+)/i,
  ]);

  if (!totalCents) missing.push('total');
  if (!baseCents) missing.push('base rate');

  // ---- dates
  // The capture runs to end-of-line rather than stopping at a comma, because
  // "September 1, 2026" contains one. Only explicit labels are matched — "from"
  // and "to" appear in far too much prose to be safe anchors.
  const checkIn = matchDate(
    source,
    [/(?:check[\s-]?in|arrival|arrive)\s*[:\s]\s*([^\n]+)/i],
    assumeYear,
  );
  const checkOut = matchDate(
    source,
    [/(?:check[\s-]?out|departure|depart)\s*[:\s]\s*([^\n]+)/i],
    assumeYear,
  );

  if (!checkIn) missing.push('check-in');
  if (!checkOut) missing.push('check-out');

  // ---- nights: stated, or derived from the dates. Never invented.
  let nights: ParsedField<number> | null = null;
  const statedNights = /(\d+)\s*nights?\b/i.exec(source);
  if (statedNights?.[1]) {
    nights = field(Number(statedNights[1]), 'high', statedNights[0]);
  } else if (checkIn && checkOut) {
    const derived = nightsBetween(checkIn.value, checkOut.value);
    if (derived !== null) {
      nights = field(derived, 'medium', `${checkIn.value} → ${checkOut.value}`);
    }
  }
  if (!nights) missing.push('nights');

  // ---- room and bed
  const roomMatch = /(?:room\s+type|room)\s*[:\s]\s*([^\n]+)/i.exec(source);
  const roomType = roomMatch?.[1] ? field(roomMatch[1].trim(), 'medium', roomMatch[0]) : null;
  if (!roomType) missing.push('room type');

  const bedMatch = /\b(king|queen|twin|double|two\s+doubles?|single|sofa\s+bed)\b[^\n]*/i.exec(source);
  const bedType = bedMatch?.[1] ? field(normaliseBed(bedMatch[1]), 'medium', bedMatch[0]) : null;
  if (!bedType) missing.push('bed type');

  // ---- cancellation policy.
  //
  // This one field decides whether a claim survives PM8, so the patterns are
  // deliberately conservative and asymmetric: an explicit non-refundable phrase
  // is trusted, but "free cancellation" is only trusted when it is not negated.
  const refundable = matchRefundable(source);
  if (!refundable) missing.push('cancellation policy');

  return {
    totalCents,
    baseCents,
    taxCents,
    nights,
    checkIn,
    checkOut,
    roomType,
    bedType,
    refundable,
    currency,
    missing: Object.freeze(missing),
    source,
  };
}

function matchMoney(
  source: string,
  currency: string,
  patterns: readonly RegExp[],
): ParsedField<number> | null {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    const captured = match?.[1];
    if (!captured) continue;
    const cents = parseMoneyToCents(captured, currency);
    if (cents !== null) return field(cents, 'high', match[0].trim());
  }
  return null;
}

function matchDate(
  source: string,
  patterns: readonly RegExp[],
  assumeYear?: number,
): ParsedField<string> | null {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    const captured = match?.[1];
    if (!captured) continue;
    const parsed = parseDate(captured.trim(), assumeYear);
    if (parsed) return field(parsed, 'high', match[0].trim());
  }
  return null;
}

/**
 * Cancellation terms.
 *
 * §2.3.3 calls a cancellation-policy mismatch "the universal denial cause, all
 * programs", so a wrong answer here is the most expensive mistake the parser
 * can make. Non-refundable phrasing wins over refundable phrasing whenever both
 * appear, because "free cancellation until 1 Sep, non-refundable thereafter" is
 * a rate that will be non-refundable by the time it matters.
 */
function matchRefundable(source: string): ParsedField<boolean> | null {
  const nonRefundable =
    /\b(non[\s-]?refundable|no[\s-]?refund|not\s+refundable|advance\s+purchase|prepay\s+and\s+save)\b/i.exec(
      source,
    );
  if (nonRefundable) return field(false, 'high', nonRefundable[0]);

  const refundable =
    /\b(free\s+cancellation|fully\s+refundable|refundable|cancel\s+for\s+free|flexible\s+rate)\b/i.exec(
      source,
    );
  if (refundable) return field(true, 'medium', refundable[0]);

  return null;
}

function normaliseBed(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.startsWith('two double') || lower === 'double') return lower.startsWith('two') ? 'Two doubles' : 'Double';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Whether a parse is complete enough to be worth showing.
 *
 * A block that yielded only a currency symbol is noise, and offering it for
 * confirmation trains the user to click through the confirmation step — which
 * is the step that makes the whole feature safe.
 */
export function isParseUseful(parsed: ParsedRate): boolean {
  return parsed.totalCents !== null || parsed.baseCents !== null;
}
