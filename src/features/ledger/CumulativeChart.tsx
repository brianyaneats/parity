'use client';

import { Disclosure, DataTable, Tooltip, type DataTableColumn } from '@/components/ui';
import { formatCents, formatCentsRounded, formatDate } from '@/lib/format';
import type { CumulativePoint } from './ledger-aggregate';

/**
 * The cumulative realized-versus-projected area chart — §7.7, §8.6.
 *
 * Hand-written inline SVG per the task brief: no charting library is
 * installed, and §6.5's nine rules (paraphrased inline below at the point
 * each is satisfied) are easier to guarantee by construction than to verify
 * against a general-purpose chart component's defaults.
 *
 *   rule 1 (≤3 categorical series) — exactly two: `--series-1` realized,
 *     `--series-2` projected. Never `--accent-lime` (rule 2, non-data only).
 *   rule 3 — n/a, this is the two-series case.
 *   rule 4 (never dual-axis) — one measure (cumulative cents), one axis.
 *   rule 5 (colour follows the entity) — realized is always series-1 and
 *     projected is always series-2, in every view of the ledger; nothing
 *     here re-colours by rank or by filtering.
 *   rule 6 — n/a, no sequential/diverging ramp in this chart.
 *   rule 7 (legend + direct labels) — the legend row below, plus an
 *     inline dollar figure at the end of each line.
 *   rule 8 (marks) — 2px stroke width, recessive gridlines on `--border`,
 *     the projected line additionally dashed as a non-colour cue.
 *   rule 9 (hover AND focus tooltips) — each date is one focusable,
 *     `Tooltip`-wrapped group; the vertical guide line is the crosshair,
 *     shown on both `:hover` and `:focus-within` via Tailwind `group-*`.
 *
 * The x-axis is **ordinal** (one evenly-spaced tick per date that has an
 * event), not a linear time scale. A linear scale would spend most of its
 * width on the long flat gaps between a handful of stays a year (§1.2: "four
 * luxury stays a year") and compress the actual events into a sliver — the
 * ordinal axis keeps every event equally visible, at the cost of gaps not
 * being visually proportional to elapsed time. That trade is stated in the
 * x-axis's own `aria-label` below rather than left implicit.
 */

const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 240;
const PAD_LEFT = 56;
const PAD_RIGHT = 68;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const PLOT_WIDTH = VIEWBOX_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEWBOX_HEIGHT - PAD_TOP - PAD_BOTTOM;
const GRID_TICKS = [0, 1 / 3, 2 / 3, 1] as const;

export function CumulativeChart({ points }: { points: readonly CumulativePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-surface-1 px-6 py-10 text-center">
        <p className="text-sm text-text-secondary">
          Not enough history yet to draw a trend line.
        </p>
        <p className="text-xs text-text-muted">
          Realized and projected savings will chart here once events land on at least two
          different dates.
        </p>
      </div>
    );
  }

  const rawMax = Math.max(
    ...points.map((p) => Math.max(p.realizedCumulativeCents, p.projectedCumulativeCents)),
  );
  const rawMin = Math.min(0, ...points.map((p) => Math.min(p.realizedCumulativeCents, p.projectedCumulativeCents)));
  // A flat, all-zero ledger still needs a non-zero denominator to plot.
  const yMax = rawMax > 0 ? rawMax : 100;
  const yMin = rawMin;
  const range = Math.max(yMax - yMin, 1);

  const x = (index: number) => PAD_LEFT + (index / (points.length - 1)) * PLOT_WIDTH;
  const y = (valueCents: number) => PAD_TOP + PLOT_HEIGHT * (1 - (valueCents - yMin) / range);
  const baselineY = y(Math.min(Math.max(0, yMin), yMax));

  const realizedLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.realizedCumulativeCents)}`).join(' ');
  const projectedLine = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.projectedCumulativeCents)}`)
    .join(' ');
  const lastX = x(points.length - 1);
  const realizedArea = `${realizedLine} L${lastX},${baselineY} L${x(0)},${baselineY} Z`;
  const projectedArea = `${projectedLine} L${lastX},${baselineY} L${x(0)},${baselineY} Z`;

  const last = points[points.length - 1];
  const first = points[0];

  const tableColumns: readonly DataTableColumn<CumulativePoint>[] = [
    { key: 'date', header: 'Date', render: (row) => formatDate(row.occurredOn) },
    {
      key: 'realized',
      header: 'Realized (cumulative)',
      numeric: true,
      render: (row) => formatCents(row.realizedCumulativeCents),
    },
    {
      key: 'projected',
      header: 'Projected (cumulative)',
      numeric: true,
      render: (row) => formatCents(row.projectedCumulativeCents),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* ------------------------------------------------------- legend */}
      {/* §6.5 rule 7: a legend in addition to the direct labels drawn on
          the chart itself — identity is never colour-only. */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5">
          <svg aria-hidden="true" viewBox="0 0 16 2" className="h-0.5 w-4 overflow-visible">
            <line x1={0} x2={16} y1={1} y2={1} className="stroke-series-1" strokeWidth={2} />
          </svg>
          Realized
        </span>
        <span className="flex items-center gap-1.5">
          <svg aria-hidden="true" viewBox="0 0 16 2" className="h-0.5 w-4 overflow-visible">
            <line x1={0} x2={16} y1={1} y2={1} className="stroke-series-2" strokeWidth={2} strokeDasharray="4 3" />
          </svg>
          Projected <span className="text-text-muted">(not yet realized)</span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="h-auto w-full"
        role="group"
        aria-label={`Cumulative savings by date, ${points.length} dated points, ordinal spacing rather than a calendar time scale`}
      >
        {/* -------------------------------------------------- gridlines */}
        {GRID_TICKS.map((frac) => {
          const value = yMin + frac * range;
          const gy = y(value);
          return (
            <g key={frac}>
              <line
                x1={PAD_LEFT}
                x2={VIEWBOX_WIDTH - PAD_RIGHT}
                y1={gy}
                y2={gy}
                className="stroke-border"
                strokeWidth={1}
              />
              <text x={PAD_LEFT - 8} y={gy} textAnchor="end" dominantBaseline="middle" className="fill-text-muted text-xs">
                {formatCentsRounded(value)}
              </text>
            </g>
          );
        })}

        {/* ----------------------------------------------------- areas */}
        <path d={realizedArea} className="fill-series-1" fillOpacity={0.18} stroke="none" />
        <path d={projectedArea} className="fill-series-2" fillOpacity={0.12} stroke="none" />

        {/* ------------------------------------------------------ lines */}
        <path d={realizedLine} className="stroke-series-1" strokeWidth={2} fill="none" strokeLinejoin="round" />
        <path
          d={projectedLine}
          className="stroke-series-2"
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
          strokeDasharray="5 4"
        />

        {/* -------------------------------------------- direct labels */}
        {last ? (
          <>
            <text
              x={lastX + 8}
              y={y(last.realizedCumulativeCents)}
              dominantBaseline="middle"
              className="fill-series-1 text-xs"
            >
              {formatCentsRounded(last.realizedCumulativeCents)}
            </text>
            <text
              x={lastX + 8}
              y={y(last.projectedCumulativeCents)}
              dominantBaseline="middle"
              className="fill-series-2 text-xs"
            >
              {formatCentsRounded(last.projectedCumulativeCents)}
            </text>
          </>
        ) : null}

        {/* x-axis end labels */}
        {first ? (
          <text x={PAD_LEFT} y={VIEWBOX_HEIGHT - 8} textAnchor="start" className="fill-text-muted text-xs">
            {formatDate(first.occurredOn)}
          </text>
        ) : null}
        <text x={lastX} y={VIEWBOX_HEIGHT - 8} textAnchor="end" className="fill-text-muted text-xs">
          {formatDate(last?.occurredOn ?? '')}
        </text>

        {/* ------------------------------------------- hover / focus points */}
        {points.map((point, i) => {
          const px = x(i);
          const columnHalfWidth = Math.max(PLOT_WIDTH / points.length / 2, 6);
          return (
            <Tooltip
              key={point.occurredOn}
              side="top"
              content={
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-text-primary">{formatDate(point.occurredOn)}</span>
                  {/* Swatch plus neutral ink rather than coloured text: the
                      series palette is verified at ≥3:1, and §6.7 requires
                      4.5:1 for body text. The swatch keeps the series identity
                      without asking the colour to carry the words. */}
                  <span className="flex items-center gap-1.5 text-text-primary">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-series-1" />
                    Realized {formatCents(point.realizedCumulativeCents)}
                  </span>
                  <span className="flex items-center gap-1.5 text-text-primary">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-series-2" />
                    Projected {formatCents(point.projectedCumulativeCents)}
                  </span>
                </span>
              }
            >
              <g
                tabIndex={0}
                role="img"
                aria-label={`${formatDate(point.occurredOn)}: realized ${formatCents(point.realizedCumulativeCents)}, projected ${formatCents(point.projectedCumulativeCents)}`}
                className="group cursor-pointer outline-none"
              >
                {/* Invisible hit column — an ≥8px target per §6.5 rule 8 even
                    though the visible marker is smaller. */}
                <rect
                  x={px - columnHalfWidth}
                  y={PAD_TOP}
                  width={columnHalfWidth * 2}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                />
                {/* The crosshair — rule 9. CSS-only, no hover state in React. */}
                <line
                  x1={px}
                  x2={px}
                  y1={PAD_TOP}
                  y2={PAD_TOP + PLOT_HEIGHT}
                  className="stroke-border-strong opacity-0 transition-opacity duration-fast ease-standard group-hover:opacity-100 group-focus-within:opacity-100"
                  strokeWidth={1}
                />
                <circle
                  cx={px}
                  cy={y(point.realizedCumulativeCents)}
                  r={3.5}
                  className="fill-series-1 stroke-surface-1"
                  strokeWidth={2}
                />
                <circle
                  cx={px}
                  cy={y(point.projectedCumulativeCents)}
                  r={3.5}
                  className="fill-series-2 stroke-surface-1"
                  strokeWidth={2}
                />
              </g>
            </Tooltip>
          );
        })}
      </svg>

      {/* §6.5 rule 7: every chart has a table view behind a disclosure. */}
      <Disclosure summary="View as table">
        <DataTable columns={tableColumns} rows={points} getRowId={(row) => row.occurredOn} />
      </Disclosure>
    </div>
  );
}
