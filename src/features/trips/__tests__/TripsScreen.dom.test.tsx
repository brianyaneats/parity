import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TripsScreen } from '../TripsScreen';
import type { TripListItemView } from '../trips-types';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

const trip = (overrides: Partial<TripListItemView>): TripListItemView => ({
  id: 't1',
  name: 'Tokyo anniversary',
  destination: 'Tokyo',
  startDate: '2026-09-01',
  endDate: '2026-09-08',
  archived: false,
  comparisonCount: 2,
  bookingCount: 1,
  realizedSavingsCents: 45_000,
  ...overrides,
});

describe('<TripsScreen /> — §7.8', () => {
  it('renders a good empty state when there are no trips yet', async () => {
    const user = userEvent.setup();
    render(<TripsScreen trips={[]} />);
    expect(screen.getByText(/no trips yet/i)).toBeInTheDocument();

    const action = screen.getByRole('button', { name: 'Start a comparison' });
    await user.click(action);
    expect(pushMock).toHaveBeenCalledWith('/compare');
  });

  it('links each trip name to its detail page', () => {
    render(<TripsScreen trips={[trip({})]} />);
    expect(screen.getByRole('link', { name: 'Tokyo anniversary' })).toHaveAttribute(
      'href',
      '/trips/t1',
    );
  });

  it('sorts by realized savings when that column header is activated', async () => {
    const user = userEvent.setup();
    render(
      <TripsScreen
        trips={[
          trip({ id: 'low', name: 'Chicago weekend', realizedSavingsCents: 1000, startDate: '2026-01-01' }),
          trip({ id: 'high', name: 'Paris spring', realizedSavingsCents: 90_000, startDate: '2026-02-01' }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /realized savings/i }));
    const rows = screen.getAllByRole('row');
    // Row 0 is the header row; row 1 should be the ascending-sorted first entry.
    expect(rows[1]).toHaveTextContent('Chicago weekend');
  });
});
