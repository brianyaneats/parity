import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { TripDetailScreen } from '@/features/trips/TripDetailScreen';
import { EmptyState } from '@/components/ui';
import type { TripDetailView } from '@/features/trips/trips-types';

export const metadata = { title: 'Trip · Parity' };

/**
 * `/trips/[id]` — §7.1, §7.8's trip detail with its savings roll-up.
 *
 * Mirrors `/compare/[id]`'s load pattern exactly (`src/app/(app)/compare/[id]/page.tsx`):
 * a missing database and a missing trip are two different failures and get two
 * different screens. A 404 for a database outage would send the user looking
 * for the wrong problem to fix.
 */
export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const trip = await loadTrip(id, session.userId);

  if (trip === 'unavailable') {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <EmptyState message="Trips need a database. Run pnpm db:migrate and pnpm db:seed, then reload." />
      </div>
    );
  }

  if (!trip) notFound();

  return <TripDetailScreen trip={trip} />;
}

async function loadTrip(id: string, userId: string): Promise<TripDetailView | null | 'unavailable'> {
  try {
    const { getTripDetail } = await import('@/infrastructure/persistence/queries/trips');
    return await getTripDetail(id, userId);
  } catch {
    return 'unavailable';
  }
}
