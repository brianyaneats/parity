import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { TripsScreen } from '@/features/trips/TripsScreen';
import type { TripListItemView } from '@/features/trips/trips-types';

export const metadata = { title: 'Trips · Parity' };

/**
 * `/trips` — §7.1, §7.8.
 *
 * The session is resolved outside the try/catch, before any data load: an
 * unauthenticated visitor is redirected, never handed a fallback — and
 * `redirect()` works by throwing, so it must not run inside a catch-all.
 * `listTrips` requires the userId; there is no unscoped call to fall back to.
 *
 * Same resilience pattern as `/compare` and `/ledger` for the load itself: a
 * dynamic import inside `try/catch` so an unreachable database degrades to an
 * empty trip list — which `TripsScreen`'s `DataTable` renders as a real,
 * actionable empty state rather than a blank page.
 */
export default async function TripsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const trips = await loadTrips(session.userId);
  return <TripsScreen trips={trips} />;
}

async function loadTrips(userId: string): Promise<readonly TripListItemView[]> {
  try {
    const { listTrips } = await import('@/infrastructure/persistence/queries/trips');
    return await listTrips(userId);
  } catch {
    return [];
  }
}
