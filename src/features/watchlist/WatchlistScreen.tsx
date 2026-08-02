'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable, type DataTableColumn, Badge, Button, EmptyState } from '@/components/ui';
import { Booking } from '@/domain/booking/Booking';
import { daysRemainingIn } from '@/domain/credit/CreditWindow';
import { cents } from '@/domain/shared/cents';
import { CHANNEL_DEFINITIONS } from '@/domain/rules/channels.rules';
import { formatCents, formatDate, formatDateTime, formatDays, formatPoints } from '@/lib/format';
import type { WatchlistBookingRow } from './types';

/**
 * `/watchlist` — refundable bookings being re-shopped before their
 * cancellation deadline (§7.6).
 *
 * Row grammar per §7.6: property, dates, what was paid, cancellation
 * deadline, last checked, next check, and a "re-shop" action.
 *
 * Eligibility reuses `Booking.isReshoppable` rather than re-deriving "still
 * refundable with a future cancellation deadline" here — the same predicate
 * the domain uses everywhere else a booking's re-shop status matters.
 */

export interface WatchlistScreenProps {
  readonly rows: readonly WatchlistBookingRow[];
  readonly todayIsoDate: string;
}

export function WatchlistScreen({ rows, todayIsoDate }: WatchlistScreenProps) {
  const router = useRouter();

  const reshoppable = useMemo(
    () =>
      rows
        .map((row) => ({ row, booking: toBooking(row) }))
        .filter(({ booking }) => booking.isReshoppable(todayIsoDate))
        .map(({ row }) => row),
    [rows, todayIsoDate],
  );

  const columns: readonly DataTableColumn<WatchlistBookingRow>[] = [
    {
      key: 'property',
      header: 'Property',
      render: (row) => (
        <div>
          <p className="font-medium text-text-primary">{row.propertyName}</p>
          <p className="text-xs text-text-muted">{CHANNEL_DEFINITIONS[row.channel].label}</p>
          {row.cheaperOptionCents != null && row.cheaperOptionCents < row.totalCents ? (
            <p className="mt-1 text-xs text-status-good">
              {formatCents(row.totalCents - row.cheaperOptionCents)} cheaper found &mdash; re-shop
              to confirm before rebooking.
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Dates',
      render: (row) => (
        <span className="tnum whitespace-nowrap">
          {formatDate(row.checkIn)} &ndash; {formatDate(row.checkOut)}
        </span>
      ),
    },
    {
      key: 'paid',
      header: 'Paid',
      numeric: true,
      render: (row) => (
        <div>
          <p className="tnum text-text-primary">{formatCents(row.totalCents)}</p>
          {row.cashChargedCents != null && row.cashChargedCents !== row.totalCents ? (
            <p className="tnum text-xs text-text-muted">
              {formatCents(row.cashChargedCents)} cash
              {row.pointsUsed ? ` + ${formatPoints(row.pointsUsed)} pts` : ''}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'cancelDeadline',
      header: 'Cancel by',
      render: (row) =>
        row.cancelDeadline ? <CancelDeadlineCell deadline={row.cancelDeadline} today={todayIsoDate} /> : '—',
    },
    {
      key: 'lastChecked',
      header: 'Last checked',
      render: (row) => (row.lastCheckedAt ? formatDateTime(row.lastCheckedAt) : 'Never'),
    },
    {
      key: 'nextCheck',
      header: 'Next check',
      render: (row) => formatDateTime(row.nextCheckAt),
    },
    {
      key: 'action',
      header: '',
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            // SPEC-GAP: `/compare` does not yet read a pre-fill query param —
            // that wiring belongs to the agent that owns `src/app/(app)/compare/**`,
            // outside this screen's owned paths. The link is forward-compatible
            // with it landing separately; today it opens a blank comparison.
            router.push(`/compare?reshopBookingId=${row.id}`)
          }
        >
          Re-shop
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-h1 text-text-primary">Watchlist</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {reshoppable.length === 0
            ? 'No refundable bookings with a future cancellation deadline yet.'
            : `${reshoppable.length} booking${reshoppable.length === 1 ? '' : 's'} being watched.`}
        </p>
      </div>

      {/* §7.6's honest caveat, stated plainly rather than only appearing once
          a cheaper rate happens to show up in a row. */}
      <p className="rounded-md border border-border bg-surface-1 p-3 text-sm text-text-secondary">
        A price drop found here is a <strong className="text-text-primary">rebook</strong>, not a
        claim. Chase&rsquo;s price-match guarantee only pays out within 24 hours of the original
        booking; after that window, capturing a lower rate means cancelling this reservation and
        booking the new one yourself.
      </p>

      {reshoppable.length === 0 ? (
        <EmptyState
          message="Bookings show up here once they are refundable and their cancellation deadline is still ahead."
          action={{ label: 'Start a comparison', onClick: () => router.push('/compare') }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={reshoppable}
          getRowId={(row) => row.id}
          emptyMessage="No refundable bookings with a future cancellation deadline yet."
          caption="Refundable bookings being re-shopped before their cancellation deadline"
        />
      )}
    </div>
  );
}

function toBooking(row: WatchlistBookingRow): Booking {
  return Booking.rehydrate({
    id: row.id,
    userId: row.userId,
    comparisonId: row.comparisonId,
    channel: row.channel,
    confirmationNumber: row.confirmationNumber,
    bookedAt: new Date(row.bookedAt),
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    totalCents: cents(row.totalCents),
    baseCents: cents(row.baseCents),
    cashChargedCents: row.cashChargedCents !== null ? cents(row.cashChargedCents) : null,
    pointsUsed: row.pointsUsed,
    prepaid: row.prepaid,
    refundable: row.refundable,
    cancelDeadline: row.cancelDeadline,
    bucketId: row.bucketId,
    status: row.status,
  });
}

function CancelDeadlineCell({ deadline, today }: { deadline: string; today: string }) {
  // `daysRemainingIn` only reads `window.end` — reused here rather than
  // reimplementing the same UTC-midnight day math the credit buckets use.
  const days = daysRemainingIn({ start: deadline, end: deadline }, today);
  const urgent = days <= 2;
  const soon = days <= 7;

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="tnum whitespace-nowrap text-text-primary">{formatDate(deadline)}</span>
      {urgent ? (
        <Badge variant="critical">{formatDays(days)} left</Badge>
      ) : soon ? (
        <Badge variant="warning">{formatDays(days)} left</Badge>
      ) : (
        <span className="text-xs text-text-muted">{formatDays(days)} left</span>
      )}
    </div>
  );
}
