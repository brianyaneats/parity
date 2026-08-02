import { WatchlistScreen } from '@/features/watchlist/WatchlistScreen';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import type { WatchlistBookingRow } from '@/features/watchlist/types';

export const metadata = { title: 'Watchlist · Parity' };

/**
 * `/watchlist` — §7.6, following `/compare`'s and `/ledger`'s
 * server-page-with-fallback pattern: a dynamic import inside `try/catch` so
 * an unreachable or unconfigured database degrades to an empty watchlist
 * instead of a broken page.
 *
 * `listWatchlistBookings` (`src/infrastructure/persistence/queries/watchlist.ts`)
 * now exists — this P1 fix's second half; the first half is
 * `RecordBookingUseCase` actually creating the rows it reads. Unlike the
 * credit buckets (`/credits` has a rule-derived fallback,
 * `computeFallbackBuckets`), a watchlist row is inherently a specific booking
 * someone made; there is nothing to compute in its place, so the honest
 * fallback here is a genuinely empty list, not fabricated data.
 * `WatchlistScreen`'s own empty state is what renders when it is.
 */
export default async function WatchlistPage() {
  const todayIsoDate = toIsoDate(new Date());
  const rows = await loadWatchlistRows();

  return <WatchlistScreen rows={rows} todayIsoDate={todayIsoDate} />;
}

async function loadWatchlistRows(): Promise<WatchlistBookingRow[]> {
  try {
    const { listWatchlistBookings } = await import('@/infrastructure/persistence/queries/watchlist');
    return await listWatchlistBookings();
  } catch {
    return [];
  }
}
