import { TripsScreen } from '@/features/trips/TripsScreen';
import type { TripListItemView } from '@/features/trips/trips-types';

export const metadata = { title: 'Trips · Parity' };

/**
 * `/trips` — §7.1, §7.8.
 *
 * Same resilience pattern as `/compare` and `/ledger`: a dynamic import
 * inside `try/catch` so an unreachable database degrades to an empty trip
 * list — which `TripsScreen`'s `DataTable` renders as a real, actionable
 * empty state rather than a blank page.
 */
export default async function TripsPage() {
  const trips = await loadTrips();
  return <TripsScreen trips={trips} />;
}

async function loadTrips(): Promise<readonly TripListItemView[]> {
  try {
    const { listTrips } = await import('@/infrastructure/persistence/queries/trips');
    return await listTrips();
  } catch {
    return [];
  }
}
