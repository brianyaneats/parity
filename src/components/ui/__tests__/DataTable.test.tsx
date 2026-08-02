import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataTableColumn } from '../DataTable';

afterEach(cleanup);

interface ChannelRow {
  readonly id: string;
  readonly channel: string;
  readonly netCents: number;
}

const rows: readonly ChannelRow[] = [
  { id: 'edit', channel: 'EDIT', netCents: 239086 },
  { id: 'fhr', channel: 'FHR', netCents: 272000 },
];

const columns: readonly DataTableColumn<ChannelRow>[] = [
  { key: 'channel', header: 'Channel', render: (row) => row.channel, sortable: true },
  {
    key: 'net',
    header: 'Effective net',
    render: (row) =>
      `$${(row.netCents / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    numeric: true,
    sortable: true,
  },
];

describe('<DataTable /> states', () => {
  it('renders a loading skeleton and no row data', () => {
    render(<DataTable columns={columns} rows={[]} getRowId={(r) => r.id} loading />);
    expect(screen.queryByText('EDIT')).not.toBeInTheDocument();
    // Skeletons are aria-hidden placeholders, not text content.
    expect(screen.queryByText('Nothing here yet.')).not.toBeInTheDocument();
  });

  it('renders the empty state with its message and optional action', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        emptyMessage="No comparisons saved yet."
        emptyAction={{ label: 'Start a comparison', onClick }}
      />,
    );
    expect(screen.getByText('No comparisons saved yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start a comparison' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the error state with a retry action', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        error="Couldn't load comparisons."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Couldn't load comparisons.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders populated rows with each column value', () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(screen.getByText('EDIT')).toBeInTheDocument();
    expect(screen.getByText('FHR')).toBeInTheDocument();
    expect(screen.getByText('$2,390.86')).toBeInTheDocument();
  });

  it('marks numeric cells with the tabular-nums attribute hook', () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} />);
    const cell = screen.getByText('$2,390.86');
    expect(cell).toHaveAttribute('data-numeric', 'true');
  });

  it('reflects the current sort via aria-sort and calls onSortChange on header click', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sortKey="net"
        sortDirection="asc"
        onSortChange={onSortChange}
      />,
    );
    const netHeader = screen.getByRole('columnheader', { name: /effective net/i });
    expect(netHeader).toHaveAttribute('aria-sort', 'ascending');

    await user.click(screen.getByRole('button', { name: /effective net/i }));
    expect(onSortChange).toHaveBeenCalledWith('net', 'desc');
  });

  it('applies a sticky header class to the header row container', () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} />);
    const columnHeader = screen.getByRole('columnheader', { name: /channel/i });
    expect(columnHeader.closest('thead')).toHaveClass('sticky');
  });
});
