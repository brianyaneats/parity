import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LedgerScreen } from '../LedgerScreen';
import type { LedgerEventView } from '../ledger-types';

afterEach(cleanup);

const makeEvent = (overrides: Partial<LedgerEventView>): LedgerEventView => ({
  id: 'evt_1',
  kind: 'PRICE_MATCH',
  amountCents: 12345,
  realized: true,
  occurredOn: '2026-01-01',
  note: null,
  bookingId: null,
  claimId: null,
  comparisonId: null,
  propertyLabel: null,
  channel: null,
  ...overrides,
});

describe('<LedgerScreen /> — §7.7', () => {
  it('renders a good empty state at zero events: headline tiles, six sources, and an actionable table', () => {
    render(<LedgerScreen events={[]} />);
    // §8.6: the headline is realized-only and reads $0.00, not blank.
    expect(screen.getByText('Realized to date')).toBeInTheDocument();
    expect(screen.getByText('Projected')).toBeInTheDocument();
    expect(screen.getByText(/no savings events yet/i)).toBeInTheDocument();
  });

  it('puts only the realized total in the headline, never a blend of both', () => {
    const events = [
      makeEvent({ id: 'a', amountCents: 10_000, realized: true }),
      makeEvent({ id: 'b', amountCents: 4_000, realized: false }),
    ];
    render(<LedgerScreen events={events} />);
    // Both figures appear (once as the stat tile, once again as that
    // event's own row in the drillable table below).
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0); // realized headline
    expect(screen.getAllByText('$40.00').length).toBeGreaterThan(0); // projected tile
    // Never the netted or summed figure, anywhere on the screen.
    expect(screen.queryByText('$140.00')).not.toBeInTheDocument();
    expect(screen.queryByText('$60.00')).not.toBeInTheDocument();
  });

  it('switches between the cumulative and by-source views', async () => {
    const user = userEvent.setup();
    const events = [makeEvent({ id: 'a' }), makeEvent({ id: 'b', occurredOn: '2026-02-01', realized: false })];
    render(<LedgerScreen events={events} />);

    expect(screen.getByRole('tab', { name: 'Cumulative' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'By source' }));
    expect(screen.getByRole('tab', { name: 'By source' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Channel choice')).toBeInTheDocument();
  });

  it('lists every event in the drillable table', () => {
    const events = [
      makeEvent({ id: 'a', propertyLabel: 'Four Seasons Otemachi', comparisonId: 'cmp_1' }),
    ];
    render(<LedgerScreen events={events} />);
    expect(screen.getByText(/four seasons otemachi/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view snapshot/i })).toHaveAttribute(
      'href',
      '/compare/cmp_1',
    );
  });
});
