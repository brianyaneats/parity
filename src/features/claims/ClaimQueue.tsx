'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, CountdownTimer, DataTable, EmptyState, type DataTableColumn } from '@/components/ui';
import { formatCents, formatDateTime } from '@/lib/format';
import { MS_PER_HOUR } from '@/domain/shared/Clock';
import { CLAIM_STATUS_LABELS, OPEN_STATUSES, type ClaimStatus } from '@/domain/claim/ClaimStatus';
import { CLAIM_STATUS_BADGE_VARIANT } from './status-presentation';

/**
 * `/claims` — the claim queue (§7.4).
 *
 * "The queue sorts by `deadline_at` ascending; anything within 24 hours pins
 * to the top with a live `CountdownTimer`." Plain ascending-by-deadline
 * already puts every *open* claim inside 24 hours near the top on its own —
 * the pin only does real work once a resolved claim with an old (already-
 * passed) deadline is in the mix, which would otherwise sort ahead of a
 * currently-urgent open one. So urgency is computed independently of the
 * base sort and the urgent partition is always rendered first, regardless of
 * how old any resolved claim's deadline is.
 */

export interface ClaimQueueRow {
  readonly id: string;
  readonly propertyName: string;
  /** ISO instant. */
  readonly bookedAt: string;
  /** ISO instant. */
  readonly deadlineAt: string;
  readonly status: ClaimStatus;
  /** The base-rate gap recorded when the claim opened — §2.3.1's estimate. */
  readonly gapCents: number | null;
  /** What the issuer actually paid, once resolved. */
  readonly awardedCents: number | null;
}

export interface ClaimQueueProps {
  readonly rows: readonly ClaimQueueRow[];
  readonly error?: string;
  /** Testability only — forwarded to every `CountdownTimer` in the pinned
   * rows and used to decide which rows count as "within 24 hours." */
  readonly now?: Date;
}

function isUrgent(row: ClaimQueueRow, nowMs: number): boolean {
  return OPEN_STATUSES.has(row.status) && new Date(row.deadlineAt).getTime() - nowMs <= 24 * MS_PER_HOUR;
}

export function ClaimQueue({ rows, error, now }: ClaimQueueProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  // Cleared the instant a retry starts, so the table falls through to
  // DataTable's loading branch instead of re-showing the stale error while
  // the server component re-fetches — see the sync effect below.
  const [localError, setLocalError] = React.useState(error);
  React.useEffect(() => setLocalError(error), [error]);

  const nowMs = (now ?? new Date()).getTime();

  const ordered = React.useMemo(() => {
    const byDeadline = [...rows].sort(
      (a, b) => new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime(),
    );
    const urgent = byDeadline.filter((row) => isUrgent(row, nowMs));
    const rest = byDeadline.filter((row) => !isUrgent(row, nowMs));
    return [...urgent, ...rest];
  }, [rows, nowMs]);

  const columns: readonly DataTableColumn<ClaimQueueRow>[] = [
    {
      key: 'property',
      header: 'Property',
      render: (row) => (
        <Link href={`/claims/${row.id}`} className="text-text-primary underline-offset-2 hover:underline">
          {row.propertyName}
        </Link>
      ),
    },
    {
      key: 'bookedAt',
      header: 'Booked',
      render: (row) => formatDateTime(row.bookedAt),
    },
    {
      key: 'deadline',
      header: 'Deadline',
      render: (row) =>
        isUrgent(row, nowMs) ? (
          <CountdownTimer deadline={row.deadlineAt} now={now} size="sm" />
        ) : (
          formatDateTime(row.deadlineAt)
        ),
    },
    {
      key: 'gap',
      header: 'Gap',
      numeric: true,
      render: (row) => (row.gapCents !== null ? formatCents(row.gapCents) : '—'),
    },
    {
      key: 'refund',
      header: 'Estimated refund',
      numeric: true,
      render: (row) => {
        // §2.3.1: partial approval is common, so a resolved claim shows what
        // actually landed rather than the pre-claim estimate.
        if (row.awardedCents !== null) return formatCents(row.awardedCents);
        if (row.gapCents !== null) return `Up to ${formatCents(row.gapCents)}`;
        return '—';
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge variant={CLAIM_STATUS_BADGE_VARIANT[row.status]}>{CLAIM_STATUS_LABELS[row.status]}</Badge>,
    },
  ];

  // No filter UI on this screen, so a zero-row result is always the truly-
  // empty case — there is no "matches your filter" state to distinguish it
  // from. That only holds while `localError`/`isPending` are also clear;
  // both keep routing through `DataTable`'s own error/loading branches.
  const isEmpty = !localError && !isPending && ordered.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        message="No claim windows open. Claims open automatically when you book through a channel with a price-match guarantee."
        action={{ label: 'Compare a stay', onClick: () => router.push('/compare') }}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      rows={ordered}
      getRowId={(row) => row.id}
      loading={isPending}
      error={localError}
      onRetry={() => {
        setLocalError(undefined);
        startTransition(() => router.refresh());
      }}
      emptyMessage="No claims yet. Recording a prepaid Edit or Chase Travel booking opens one automatically."
      caption="Price-match claims, sorted by deadline"
    />
  );
}
