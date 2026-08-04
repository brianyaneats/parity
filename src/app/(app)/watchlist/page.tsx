import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { WatchlistScreen } from '@/features/watchlist/WatchlistScreen';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import type { WatchlistBookingRow } from '@/features/watchlist/types';

export const metadata = { title: 'Watchlist · Parity' };

/**
 * `/watchlist` — §7.6, following `/compare`'s and `/ledger`'s
 * server-page-with-fallback pattern: session resolved first (outside the
 * try/catch, since `redirect()` throws), then a dynamic import inside
 * `try/catch` so an unreachable or unconfigured database degrades to an
 * empty watchlist instead of a broken page.
 *
 * `listWatchlistBookings` requires the userId — a watchlist row is a real
 * booking someone made, and §12 treats "which hotels you are considering"
 * as sensitive throughout.
 *
 * Unlike the credit buckets (`/credits` has a rule-derived fallback,
 * `computeFallbackBuckets`), a watchlist row is inherently a specific booking;
 * there is nothing to compute in its place, so the honest fallback here is a
 * genuinely empty list, not fabricated data. `WatchlistScreen`'s own empty
 * state is what renders when it is.
 */
export default async function WatchlistPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const todayIsoDate = toIsoDate(new Date());
  const rows = await loadWatchlistRows(session.userId);

  return <WatchlistScreen rows={rows} todayIsoDate={todayIsoDate} />;
}

async function loadWatchlistRows(userId: string): Promise<WatchlistBookingRow[]> {
  try {
    const { listWatchlistBookings } = await import('@/infrastructure/persistence/queries/watchlist');
    return await listWatchlistBookings(userId);
  } catch {
    return [];
  }
}
