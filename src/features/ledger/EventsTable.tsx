'use client';

import Link from 'next/link';
import { Button, Badge, DataTable, type DataTableColumn } from '@/components/ui';
import { formatCents, formatDate } from '@/lib/format';
import { SOURCE_DEFINITIONS } from './ledger-aggregate';
import { toCsv, type LedgerCsvRow } from './ledger-csv';
import type { LedgerEventView } from './ledger-types';

/**
 * The raw, drillable event feed and its CSV export — §7.7: "Every event is
 * drillable to its booking and its comparison snapshot. Include a CSV
 * export."
 *
 * There is no standalone booking-detail route in the spec's route map
 * (§7.1) — a booking's own record lives inside the comparison it came from
 * (§4.3's immutable snapshot). So "drillable to its booking" resolves here
 * to a link at `/compare/[id]`, the comparison-snapshot screen, which is
 * where both the booking and the numbers that justified it actually live.
 * An event with no linked booking (a manually logged credit burn, say)
 * renders as plainly non-drillable rather than guessing a target.
 */

const LABEL_BY_KIND = new Map(SOURCE_DEFINITIONS.map((def) => [def.kind, def.label]));

export function EventsTable({ events }: { events: readonly LedgerEventView[] }) {
  const columns: readonly DataTableColumn<LedgerEventView>[] = [
    { key: 'date', header: 'Date', render: (row) => formatDate(row.occurredOn) },
    { key: 'source', header: 'Source', render: (row) => LABEL_BY_KIND.get(row.kind) ?? row.kind },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      render: (row) => formatCents(row.amountCents),
    },
    {
      key: 'status',
      header: 'Status',
      // §6.7: colour is never the sole carrier — `Badge` always pairs its
      // colour with an icon and this text label.
      render: (row) => (
        <Badge variant={row.realized ? 'good' : 'neutral'}>{row.realized ? 'Realized' : 'Projected'}</Badge>
      ),
    },
    {
      key: 'property',
      header: 'Booking',
      render: (row) => (row.propertyLabel ? `${row.propertyLabel}${row.channel ? ` · ${row.channel}` : ''}` : '—'),
    },
    {
      key: 'drilldown',
      header: 'Comparison',
      render: (row) =>
        row.comparisonId ? (
          <Link
            href={`/compare/${row.comparisonId}`}
            className="rounded-sm text-text-secondary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            View snapshot
          </Link>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
  ];

  const exportCsv = () => {
    const rows: LedgerCsvRow[] = events.map((event) => ({
      id: event.id,
      occurredOn: event.occurredOn,
      kind: event.kind,
      amountCents: event.amountCents,
      realized: event.realized,
      note: event.note,
      bookingId: event.bookingId,
    }));
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `parity-savings-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3 text-text-primary">All events</h2>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={events.length === 0}>
          Export CSV
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={events}
        getRowId={(row) => row.id}
        emptyMessage="No savings events yet. Save a comparison, resolve a claim, or burn a credit and it will show up here."
        caption="Savings ledger events"
      />
    </div>
  );
}
