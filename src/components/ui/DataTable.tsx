'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { FOCUS_RING } from './_shared';

/**
 * DataTable — generic over a row type. §6.4 required states: loading
 * skeleton, empty, error, populated, sorted, row-hover, sticky header.
 *
 * This component is presentation-only for sorting: it renders the current
 * `sortKey`/`sortDirection` (as `aria-sort` plus a chevron) and calls
 * `onSortChange` when a sortable header is activated, but it never sorts
 * `rows` itself. The generic `Row` type has no comparable shape to sort by
 * in the general case — the caller (which knows the row shape) owns the
 * actual comparator and passes back already-sorted `rows`.
 */
export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => React.ReactNode;
  /** Right-aligns the column and applies tabular-nums via the `data-numeric`
   * attribute hook (§6.3, globals.css). */
  readonly numeric?: boolean;
  readonly sortable?: boolean;
  readonly widthClassName?: string;
}

export type SortDirection = 'asc' | 'desc';

export interface DataTableProps<Row> {
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly getRowId: (row: Row) => string;
  readonly loading?: boolean;
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly emptyMessage?: string;
  readonly emptyAction?: { readonly label: string; readonly onClick: () => void };
  readonly sortKey?: string;
  readonly sortDirection?: SortDirection;
  readonly onSortChange?: (key: string, direction: SortDirection) => void;
  readonly caption?: string;
  readonly className?: string;
  readonly skeletonRowCount?: number;
  readonly onRowClick?: (row: Row) => void;
}

export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  loading = false,
  error,
  onRetry,
  emptyMessage = 'Nothing here yet.',
  emptyAction,
  sortKey,
  sortDirection,
  onSortChange,
  caption,
  className,
  skeletonRowCount = 5,
  onRowClick,
}: DataTableProps<Row>) {
  const columnCount = columns.length;

  const handleSort = (column: DataTableColumn<Row>) => {
    if (!column.sortable || !onSortChange) return;
    const isActive = sortKey === column.key;
    const nextDirection: SortDirection = isActive && sortDirection === 'asc' ? 'desc' : 'asc';
    onSortChange(column.key, nextDirection);
  };

  return (
    <div className={cn('overflow-auto rounded-lg border border-border', className)}>
      <table className="w-full min-w-max border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {columns.map((column) => {
              const isActive = sortKey === column.key;
              const ariaSort = !column.sortable
                ? undefined
                : isActive
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
              const SortIcon = isActive ? (sortDirection === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    'border-b border-border px-3 py-2 text-left text-xs font-medium text-text-muted',
                    column.numeric && 'text-right',
                    column.widthClassName,
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm text-xs font-medium text-text-muted hover:text-text-primary',
                        column.numeric && 'flex-row-reverse',
                        FOCUS_RING,
                      )}
                    >
                      {column.header}
                      <SortIcon
                        className={cn('size-3.5 shrink-0', isActive ? 'text-text-primary' : 'text-text-muted')}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {error ? (
            <tr>
              <td colSpan={columnCount} className="px-3 py-8">
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-sm text-status-critical">{error}</p>
                  {onRetry ? (
                    <Button variant="secondary" size="sm" onClick={onRetry}>
                      Retry
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : loading ? (
            Array.from({ length: skeletonRowCount }, (_, rowIndex) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={`skeleton-${rowIndex}`}>
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2">
                    <Skeleton className="h-4 w-full max-w-32" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-3 py-8">
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-sm text-text-secondary">{emptyMessage}</p>
                  {emptyAction ? (
                    <Button variant="secondary" size="sm" onClick={emptyAction.onClick}>
                      {emptyAction.label}
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const rowId = getRowId(row);
              return (
                <tr
                  key={rowId}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('hover:bg-glass-hover', onRowClick && 'cursor-pointer')}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-numeric={column.numeric || undefined}
                      className={cn('border-b border-border px-3 py-2 text-text-primary', column.numeric && 'text-right')}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
