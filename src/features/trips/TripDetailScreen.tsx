import Link from 'next/link';
import { Badge, Card, DataTable, StatTile, type DataTableColumn } from '@/components/ui';
import { formatCents, formatDate } from '@/lib/format';
import { formatDateRange } from './trip-format';
import type { TripBookingView, TripComparisonView, TripDetailView } from './trips-types';
import type { BadgeProps } from '@/components/ui';

/**
 * `/trips/[id]` — §7.8's trip detail: comparisons, bookings, and "a per-trip
 * savings roll-up."
 *
 * A server component (no client state needed here — everything is
 * already-loaded, non-interactive data) unlike `TripsScreen`, which owns
 * sortable table state.
 */
export function TripDetailScreen({ trip }: { trip: TripDetailView }) {
  const comparisonColumns: readonly DataTableColumn<TripComparisonView>[] = [
    {
      key: 'property',
      header: 'Property',
      render: (row) => (
        <Link
          href={`/compare/${row.id}`}
          className="rounded-sm text-text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {row.propertyLabel}
        </Link>
      ),
    },
    {
      key: 'dates',
      header: 'Dates',
      render: (row) => `${formatDate(row.checkIn)} – ${formatDate(row.checkOut)}`,
    },
    { key: 'nights', header: 'Nights', numeric: true, render: (row) => String(row.nights) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge variant={comparisonStatusVariant(row.status)}>{row.status}</Badge>,
    },
    { key: 'channel', header: 'Chosen channel', render: (row) => row.chosenChannel ?? '—' },
  ];

  const bookingColumns: readonly DataTableColumn<TripBookingView>[] = [
    { key: 'channel', header: 'Channel', render: (row) => row.channel },
    { key: 'booked', header: 'Booked', render: (row) => formatDate(row.bookedAt) },
    {
      key: 'stay',
      header: 'Stay',
      render: (row) => `${formatDate(row.checkIn)} – ${formatDate(row.checkOut)}`,
    },
    { key: 'total', header: 'Total', numeric: true, render: (row) => formatCents(row.totalCents) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge variant={bookingStatusVariant(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'cancel',
      header: 'Cancel by',
      render: (row) =>
        row.cancelDeadline ? formatDate(row.cancelDeadline) : row.refundable ? '—' : 'Non-refundable',
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 lg:p-6">
      <div>
        <Link
          href="/trips"
          className="rounded-sm text-xs text-text-secondary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          ← All trips
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-h1 text-text-primary">{trip.name}</h1>
          {trip.archived ? <Badge variant="neutral">Archived</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          {trip.destination ?? 'No destination set'} · {formatDateRange(trip.startDate, trip.endDate)}
        </p>
      </div>

      {/* §8.6: the roll-up keeps the same realized/projected split as the
          ledger — a trip's headline is never a netted blend of the two. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          hero
          label="Realized savings"
          value={formatCents(trip.realizedSavingsCents)}
          sublabel="Approved claims, burned credits and bookings on this trip"
        />
        <StatTile
          label="Projected"
          value={formatCents(trip.projectedSavingsCents)}
          sublabel="Not yet realized"
        />
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-h2 text-text-primary">Comparisons</h2>
        <DataTable
          columns={comparisonColumns}
          rows={trip.comparisons}
          getRowId={(row) => row.id}
          emptyMessage="No comparisons saved to this trip yet."
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-h2 text-text-primary">Bookings</h2>
        <DataTable
          columns={bookingColumns}
          rows={trip.bookings}
          getRowId={(row) => row.id}
          emptyMessage="No bookings recorded for this trip yet."
        />
      </Card>
    </div>
  );
}

function comparisonStatusVariant(status: TripComparisonView['status']): BadgeProps['variant'] {
  switch (status) {
    case 'BOOKED':
      return 'good';
    case 'ABANDONED':
      return 'critical';
    case 'DECIDED':
    case 'DRAFT':
    default:
      return 'neutral';
  }
}

function bookingStatusVariant(status: TripBookingView['status']): BadgeProps['variant'] {
  switch (status) {
    case 'ACTIVE':
      return 'good';
    case 'CANCELLED':
      return 'critical';
    case 'COMPLETED':
    default:
      return 'neutral';
  }
}
