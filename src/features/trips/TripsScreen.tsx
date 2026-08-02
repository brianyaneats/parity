'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type DataTableColumn, type SortDirection } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { formatDateRange } from './trip-format';
import type { TripListItemView } from './trips-types';

/**
 * `/trips` — §7.1, §7.8: "trips group comparisons and bookings; trip detail
 * shows a per-trip savings roll-up." This is the list half; the roll-up
 * itself lives on `TripDetailScreen`.
 */
export function TripsScreen({ trips }: { trips: readonly TripListItemView[] }) {
  const [sortKey, setSortKey] = useState('start');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sorted = useMemo(() => sortTrips(trips, sortKey, sortDirection), [trips, sortKey, sortDirection]);

  const columns: readonly DataTableColumn<TripListItemView>[] = [
    {
      key: 'name',
      header: 'Trip',
      sortable: true,
      render: (row) => (
        <Link
          href={`/trips/${row.id}`}
          className="rounded-sm font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {row.name}
        </Link>
      ),
    },
    { key: 'destination', header: 'Destination', render: (row) => row.destination ?? '—' },
    {
      key: 'start',
      header: 'Dates',
      sortable: true,
      render: (row) => formatDateRange(row.startDate, row.endDate),
    },
    {
      key: 'comparisons',
      header: 'Comparisons',
      numeric: true,
      render: (row) => String(row.comparisonCount),
    },
    { key: 'bookings', header: 'Bookings', numeric: true, render: (row) => String(row.bookingCount) },
    {
      key: 'savings',
      header: 'Realized savings',
      numeric: true,
      sortable: true,
      render: (row) => formatCents(row.realizedSavingsCents),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 lg:p-6">
      <header>
        <h1 className="text-h1 text-text-primary">Trips</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Comparisons and bookings grouped by trip, each with its own savings roll-up.
        </p>
      </header>

      <DataTable
        columns={columns}
        rows={sorted}
        getRowId={(row) => row.id}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={(key, direction) => {
          setSortKey(key);
          setSortDirection(direction);
        }}
        emptyMessage="No trips yet. Group a saved comparison under a trip from /compare to start tracking it here."
        caption="Trips"
      />
    </div>
  );
}

function sortTrips(
  trips: readonly TripListItemView[],
  sortKey: string,
  direction: SortDirection,
): readonly TripListItemView[] {
  const factor = direction === 'asc' ? 1 : -1;
  const withKey = [...trips];

  withKey.sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return factor * a.name.localeCompare(b.name);
      case 'savings':
        return factor * (a.realizedSavingsCents - b.realizedSavingsCents);
      case 'start':
      default:
        // Trips without a start date sort last regardless of direction —
        // an unscheduled trip isn't meaningfully "earlier" or "later."
        if (!a.startDate && !b.startDate) return 0;
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return factor * a.startDate.localeCompare(b.startDate);
    }
  });

  return withKey;
}
