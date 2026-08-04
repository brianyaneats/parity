import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { CreditWallet } from '@/features/credits/CreditWallet';
import { computeFallbackBuckets } from '@/features/credits/fallback';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import type { CardKind } from '@/domain/rules/price-match.rules';
import type { BucketRow, RoutableComparison } from '@/features/credits/types';

export const metadata = { title: 'Credits · Parity' };

/**
 * `/credits` — the credit wallet (§7.5).
 *
 * Follows `/watchlist`'s server-page-with-fallback pattern: session resolved
 * first (outside the try/catch, since `redirect()` throws), then a dynamic
 * import inside `try/catch` so an unreachable database degrades the read
 * rather than crashing the route.
 *
 * `src/infrastructure/persistence/queries/credits.ts` now exists — it did
 * not when `computeFallbackBuckets` was written; see that function's own doc
 * comment for the gap it filled at the time. A signed-in caller with rows in
 * `credit_buckets` (today, only the seeded demo user) now sees them live
 * (`isLive: true`). A caller with zero rows keeps exactly the same
 * rule-derived fallback as before (`isLive: false`) — `computeFallbackBuckets`
 * is still correct, and `CreditWallet` already discloses that fallback
 * honestly, so there is no reason to replace working behaviour just because
 * a live path now also exists.
 */
export default async function CreditsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const todayIsoDate = toIsoDate(new Date());
  const [{ buckets, isLive }, activeCardKinds] = await Promise.all([
    loadBuckets(session.userId, todayIsoDate),
    loadActiveCardKinds(session.userId),
  ]);
  const comparisons = loadRoutableComparisons();

  return (
    <CreditWallet
      buckets={buckets}
      comparisons={comparisons}
      todayIsoDate={todayIsoDate}
      isLive={isLive}
      activeCardKinds={activeCardKinds}
    />
  );
}

/**
 * Honest cards gating (Feature B, item 2) — which cards the caller has
 * actually told `/settings` they hold. `CreditWallet` shows every card's
 * section when this comes back empty (nothing configured — today's founding
 * assumption, and what the seeded demo account still shows), otherwise only
 * the sections for cards actually in this list. An unreachable database
 * degrades to the same empty list — "nothing configured" — rather than
 * hiding a card the caller might really hold; that is the read failing open,
 * matching `loadBuckets`' own degrade-the-read-not-the-route direction.
 */
async function loadActiveCardKinds(userId: string): Promise<CardKind[]> {
  try {
    const { listActiveCards } = await import('@/infrastructure/persistence/queries/cards');
    return [...(await listActiveCards(userId))];
  } catch {
    return [];
  }
}

async function loadBuckets(
  userId: string,
  todayIsoDate: string,
): Promise<{ buckets: BucketRow[]; isLive: boolean }> {
  try {
    const { listCreditBuckets } = await import('@/infrastructure/persistence/queries/credits');
    const rows = await listCreditBuckets(userId);
    if (rows.length > 0) return { buckets: rows, isLive: true };
  } catch {
    // Fall through to the rule-derived fallback below — an unreachable
    // database degrades the wallet's liveness, not the route itself.
  }

  try {
    return { buckets: computeFallbackBuckets(todayIsoDate, userId), isLive: false };
  } catch {
    // A defect in the pure fallback computation should still render a usable
    // (empty) wallet rather than crash the route.
    return { buckets: [], isLive: false };
  }
}

function loadRoutableComparisons(): RoutableComparison[] {
  // No saved-comparisons query exists yet either (same reasoning
  // `computeFallbackBuckets`'s original doc comment gave), so the "route a
  // booking to this bucket" action always renders its own empty state today.
  // `CreditWallet` already handles an empty list gracefully per bucket, and
  // its props shape does not need to change when a real query is wired in
  // here.
  return [];
}
