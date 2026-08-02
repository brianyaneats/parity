import { CreditWallet } from '@/features/credits/CreditWallet';
import { computeFallbackBuckets } from '@/features/credits/fallback';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import type { BucketRow, RoutableComparison } from '@/features/credits/types';

export const metadata = { title: 'Credits · Parity' };

/**
 * `/credits` — the credit wallet (§7.5).
 *
 * Follows `/compare`'s server-page-with-fallback pattern: load what data
 * exists, degrade to a computed-but-honest default rather than a blank
 * screen, and never let a data failure crash the route.
 *
 * There is no `credit_buckets` (or `comparisons`) query module to call yet —
 * only `properties.ts` and `badges.ts` exist under
 * `src/infrastructure/persistence/queries/` at the time this screen was
 * built, and that directory is outside this screen's owned paths. Unlike a
 * live database call, importing a module that does not exist is a
 * compile-time failure (`tsc` resolves dynamic `import()` specifiers), so the
 * usual "try the query, catch a connection failure" shape does not apply
 * here — there is nothing real to try yet. `computeFallbackBuckets` fills
 * that gap with correct-by-construction data instead of fabricated numbers:
 * see its doc comment for the full reasoning. The `try/catch` below still
 * guards the computation itself, so a defect in the fallback degrades to an
 * empty wallet rather than a crashed page.
 */
export default async function CreditsPage() {
  const todayIsoDate = toIsoDate(new Date());
  const { buckets, isLive } = loadBuckets(todayIsoDate);
  const comparisons = loadRoutableComparisons();

  return (
    <CreditWallet
      buckets={buckets}
      comparisons={comparisons}
      todayIsoDate={todayIsoDate}
      isLive={isLive}
    />
  );
}

function loadBuckets(todayIsoDate: string): { buckets: BucketRow[]; isLive: boolean } {
  try {
    return { buckets: computeFallbackBuckets(todayIsoDate), isLive: false };
  } catch {
    // A defect in the pure fallback computation should still render a usable
    // (empty) wallet rather than crash the route.
    return { buckets: [], isLive: false };
  }
}

function loadRoutableComparisons(): RoutableComparison[] {
  // No saved-comparisons query exists yet either (same reasoning as above),
  // so the "route a booking to this bucket" action always renders its own
  // empty state today. `CreditWallet` already handles an empty list
  // gracefully per bucket, and its props shape does not need to change when
  // a real query is wired in here.
  return [];
}
