'use client';

import { Disclosure, DataTable, Tooltip, type DataTableColumn } from '@/components/ui';
import { formatCents } from '@/lib/format';
import type { SourceBreakdown } from './ledger-aggregate';

/**
 * The "by source" breakdown — §7.7, §8.1, §13.3.
 *
 * §13.3 in the build spec is explicit about this component: "The ledger's
 * by-source breakdown has six categories. It is specified as a *ranked bar
 * list*, not a multi-hue chart, precisely for this reason [the three-series
 * cap]. Do not 'improve' it into a six-color pie."
 *
 * The six sources are told apart by **row identity** (label, position, rank)
 * — never by a sixth hue. The only two colours used anywhere in this
 * component are `--series-1` (realized) and `--series-2` (projected), the
 * *same two* colours the cumulative chart uses for the same two concepts
 * (§8.6). That is how six categories coexist with a three-series cap: colour
 * encodes realized-versus-projected — a fact every row shares — and the
 * *source* is encoded the way a list already encodes identity, in text and
 * rank, which is exactly why §7.7 specifies a list instead of a chart here.
 *
 * Row grammar mirrors §8.1's `ChannelBar`: `[name + sublabel] [bar track]
 * [value]`. Bar length is `total / max(all totals)` so all six bars share one
 * scale, anchored to the left baseline, with 4px-equivalent rounded ends
 * (`rounded-sm`) and a 2px surface-coloured gap between the realized and
 * projected segments of the same bar (`§6.5` rule 8) — a real spacer div
 * rather than a border, so it reads as a gap rather than an outline.
 */

export function BySourceList({ rows }: { rows: readonly SourceBreakdown[] }) {
  const maxTotal = Math.max(...rows.map((r) => r.totalCents), 1);

  const tableColumns: readonly DataTableColumn<SourceBreakdown>[] = [
    { key: 'source', header: 'Source', render: (row) => row.label },
    { key: 'realized', header: 'Realized', numeric: true, render: (row) => formatCents(row.realizedCents) },
    { key: 'projected', header: 'Projected', numeric: true, render: (row) => formatCents(row.projectedCents) },
    { key: 'total', header: 'Total', numeric: true, render: (row) => formatCents(row.totalCents) },
    { key: 'count', header: 'Events', numeric: true, render: (row) => String(row.eventCount) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-pill bg-series-1" />
          Realized
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-pill bg-series-2" />
          Projected <span className="text-text-muted">(not yet realized)</span>
        </span>
      </div>

      <ul className="flex flex-col gap-2" aria-label="Savings by source, ranked by total">
        {rows.map((row) => (
          <SourceRow key={row.kind} row={row} maxTotal={maxTotal} />
        ))}
      </ul>

      <Disclosure summary="View as table">
        <DataTable columns={tableColumns} rows={rows} getRowId={(row) => row.kind} />
      </Disclosure>
    </div>
  );
}

function SourceRow({ row, maxTotal }: { row: SourceBreakdown; maxTotal: number }) {
  const realizedPct = clampPct((row.realizedCents / maxTotal) * 100);
  const projectedPct = clampPct((row.projectedCents / maxTotal) * 100);
  const hasBoth = row.realizedCents > 0 && row.projectedCents > 0;

  return (
    <li className="grid grid-cols-1 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-3 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:gap-4">
      <div className="min-w-0">
        <p className="truncate text-h3 text-text-primary">{row.label}</p>
        <p className="mt-0.5 truncate text-xs text-text-muted">{row.sublabel}</p>
      </div>

      <div
        className="relative h-6 w-full overflow-hidden rounded-sm bg-glass"
        role="img"
        aria-label={`${row.label}: ${formatCents(row.realizedCents)} realized, ${formatCents(row.projectedCents)} projected, ${formatCents(row.totalCents)} total`}
      >
        {/* Anchored to the left baseline — §8.1. Realized first, then a 2px
            surface-coloured gap, then projected, so the two segments read as
            genuinely separate rather than one two-tone block. */}
        <div className="absolute inset-y-0 left-0 flex">
          <div
            className="h-full rounded-sm bg-series-1 transition-[width] duration-base ease-standard"
            style={{ width: `${realizedPct}%` }}
          />
          {hasBoth ? <div className="h-full w-0.5 shrink-0 bg-surface-1" aria-hidden="true" /> : null}
          <div
            className="h-full rounded-sm bg-series-2 transition-[width] duration-base ease-standard"
            style={{ width: `${projectedPct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-0.5">
        {/* The focusable trigger carries the accessible name; the Tooltip is
            supplementary detail, not the only source of it (§6.5 rule 9 —
            hover AND keyboard focus show the same content). */}
        <Tooltip
          side="left"
          content={
            // The series palette is verified at ≥3:1, which §6.7 allows for
            // graphical objects and large text but not for body text (4.5:1).
            // So the series identity is carried by a swatch and the words stay
            // on --text-primary — which is also what §6.5 rule 7 wants: identity
            // never carried by colour alone.
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-text-primary">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-series-1" />
                Realized {formatCents(row.realizedCents)}
              </span>
              <span className="flex items-center gap-1.5 text-text-primary">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-series-2" />
                Projected {formatCents(row.projectedCents)}
              </span>
              <span className="text-text-muted">
                {row.eventCount} event{row.eventCount === 1 ? '' : 's'}
              </span>
            </span>
          }
        >
          <button
            type="button"
            className="tnum rounded-sm text-h3 text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {formatCents(row.totalCents)}
          </button>
        </Tooltip>
        <p className="tnum text-xs text-text-muted">
          {row.realizedCents > 0 && row.projectedCents > 0
            ? `${formatCents(row.realizedCents)} realized · ${formatCents(row.projectedCents)} projected`
            : row.projectedCents > 0
              ? `${formatCents(row.projectedCents)} projected`
              : row.realizedCents > 0
                ? `${formatCents(row.realizedCents)} realized`
                : 'No events yet'}
        </p>
      </div>
    </li>
  );
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
