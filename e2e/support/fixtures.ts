/**
 * Typed access to the engine's ground-truth fixtures — §3.8, §0.2.
 *
 * The E2E flows that exercise the comparator (compare-and-decide,
 * clawback-guard, fhr-asymmetry, mobile-compare) drive the UI with the exact
 * inputs from `src/domain/engine/__fixtures__/engine.fixtures.json` and assert
 * the exact numbers it publishes, rather than re-deriving or re-typing them.
 * That file is read-only from here — per §0.2 it outranks any implementation,
 * including these tests, and it is owned by the engine work, not by e2e/**.
 *
 * Importing it directly (instead of retyping "239086" by hand into a dozen
 * `expect()` calls) means a genuine fixture change is the only thing that can
 * change what these tests assert against.
 */
import fixturesJson from '../../src/domain/engine/__fixtures__/engine.fixtures.json';

export interface FixtureQuote {
  readonly channel: string;
  readonly totalCents: number;
  readonly prepaid: boolean;
  readonly refundable: boolean;
}

export interface ExpectedRow {
  readonly channel: string;
  readonly net?: number;
  readonly [key: string]: unknown;
}

export interface FixtureCase {
  readonly id: string;
  readonly title: string;
  readonly contextOverrides: Readonly<Record<string, unknown>>;
  readonly quoteSet?: string;
  readonly quotes?: readonly FixtureQuote[];
  readonly expectedWinner: string;
  readonly expectedRankedOrder?: readonly string[];
  readonly expectedRows: readonly ExpectedRow[];
}

interface FixturesFile {
  readonly sharedContext: Readonly<Record<string, unknown>>;
  readonly sharedQuoteSets: Readonly<Record<string, readonly FixtureQuote[]>>;
  readonly cases: readonly FixtureCase[];
}

const fixtures = fixturesJson as unknown as FixturesFile;

export const SHARED_CONTEXT = fixtures.sharedContext;

export function fixtureCase(id: string): FixtureCase {
  const found = fixtures.cases.find((c) => c.id === id);
  if (!found) throw new Error(`Fixture case "${id}" not found in engine.fixtures.json`);
  return found;
}

export function quoteSet(name: string): readonly FixtureQuote[] {
  const set = fixtures.sharedQuoteSets[name];
  if (!set) throw new Error(`Quote set "${name}" not found in engine.fixtures.json`);
  return set;
}

export function quoteFor(testCase: FixtureCase, channel: string): FixtureQuote {
  const quotes = testCase.quotes ?? (testCase.quoteSet ? quoteSet(testCase.quoteSet) : []);
  const found = quotes.find((q) => q.channel === channel);
  if (!found) throw new Error(`No "${channel}" quote in fixture case "${testCase.id}"`);
  return found;
}

export function expectedRow(testCase: FixtureCase, channel: string): ExpectedRow {
  const row = testCase.expectedRows.find((r) => r.channel === channel);
  if (!row) throw new Error(`No expected row for "${channel}" in fixture case "${testCase.id}"`);
  return row;
}

/** `354000` cents → `"3540.00"`, the raw dollar string `CurrencyInput` accepts while focused. */
export function centsToDollarString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${dollars}.${remainder}`;
}
