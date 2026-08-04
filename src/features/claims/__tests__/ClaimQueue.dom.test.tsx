import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimQueue, type ClaimQueueRow } from '../ClaimQueue';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: pushMock }) }));

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

const NOW = new Date('2026-07-27T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function iso(msFromNow: number): string {
  return new Date(NOW.getTime() + msFromNow).toISOString();
}

const rows: readonly ClaimQueueRow[] = [
  {
    // Deadline is far in the future but the claim is resolved — its old-ish
    // deadline must NOT let it sort ahead of a currently-urgent open claim.
    id: 'resolved-old-deadline',
    propertyName: 'Bulgari Tokyo',
    bookedAt: iso(-72 * HOUR),
    deadlineAt: iso(-48 * HOUR),
    status: 'APPROVED',
    gapCents: 14_947,
    awardedCents: 10_000,
  },
  {
    id: 'urgent-open',
    propertyName: 'Four Seasons Otemachi',
    bookedAt: iso(-22 * HOUR),
    deadlineAt: iso(2 * HOUR),
    status: 'ELIGIBLE',
    gapCents: 22_000,
    awardedCents: null,
  },
  {
    id: 'far-out-open',
    propertyName: 'Andaz Toranomon Hills',
    bookedAt: iso(-1 * HOUR),
    deadlineAt: iso(30 * HOUR),
    status: 'ELIGIBLE',
    gapCents: 5_000,
    awardedCents: null,
  },
];

describe('<ClaimQueue /> — §7.4 the claim queue', () => {
  it('pins the open claim inside 24 hours to the top, ahead of a resolved claim with an earlier deadline', () => {
    render(<ClaimQueue rows={rows} now={NOW} />);
    const propertyCells = screen.getAllByRole('link').map((el) => el.textContent);
    expect(propertyCells[0]).toBe('Four Seasons Otemachi');
  });

  it('renders a live CountdownTimer only for the row pinned as urgent', () => {
    render(<ClaimQueue rows={rows} now={NOW} />);
    // Exactly one row is open and inside 24 hours.
    expect(screen.getAllByRole('timer')).toHaveLength(1);
  });

  it('shows the estimated refund as "Up to $X" before resolution and the awarded amount after', () => {
    render(<ClaimQueue rows={rows} now={NOW} />);
    expect(screen.getByText('Up to $220.00')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('links each property name to its claim kit', () => {
    render(<ClaimQueue rows={rows} now={NOW} />);
    const link = screen.getByRole('link', { name: 'Andaz Toranomon Hills' });
    expect(link).toHaveAttribute('href', '/claims/far-out-open');
  });

  it('renders the empty state with a useful message and an action back to /compare when there are no claims', async () => {
    const user = userEvent.setup();
    render(<ClaimQueue rows={[]} now={NOW} />);
    expect(screen.getByText(/no claim windows open/i)).toBeInTheDocument();

    const action = screen.getByRole('button', { name: 'Compare a stay' });
    await user.click(action);
    expect(pushMock).toHaveBeenCalledWith('/compare');
  });

  it('renders the error state with a retry action', () => {
    render(<ClaimQueue rows={[]} error="Couldn't load claims." now={NOW} />);
    expect(screen.getByText("Couldn't load claims.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
