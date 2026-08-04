import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui';
import { CreditPostingTracker } from '../CreditPostingTracker';
import type { PostingListItem } from '../types';

/**
 * "Did it actually post?" — the `/credits` attention section. Server actions
 * (`../postingActions`) are mocked the same way `OnboardingBanner.dom.test.tsx`
 * mocks `onboardingActions`: `vi.hoisted` because `vi.mock`'s factory runs
 * before any `const` below it would exist. Wrapped in `ToastProvider` the
 * same way `ClaimKit.dom.test.tsx` wraps `ClaimKit` — every row here calls
 * `useToast()` unconditionally.
 */

const { markPostedMock, markMissingMock, recordPostingMock, refreshMock } = vi.hoisted(() => ({
  markPostedMock: vi.fn(),
  markMissingMock: vi.fn(),
  recordPostingMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('../postingActions', () => ({
  markPosted: markPostedMock,
  markMissing: markMissingMock,
  recordPosting: recordPostingMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

beforeEach(() => {
  markPostedMock.mockReset();
  markMissingMock.mockReset();
  recordPostingMock.mockReset();
  refreshMock.mockReset();
});

/**
 * `userEvent.setup()` installs its own `navigator.clipboard` stub (visible as
 * the `Manage ClipboardSub` internal symbol) the first time it runs, which
 * clobbers any `navigator.clipboard` defined beforehand — so the spy has to
 * be attached *after* `setup()`, not in a shared `beforeEach`.
 */
function spyOnClipboardWrite() {
  return vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
}

afterEach(cleanup);

/** `days` before today, at UTC midnight — matches how `daysSinceCharge` reads `chargedOn`. */
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function posting(over: Partial<PostingListItem> & Pick<PostingListItem, 'id' | 'chargedOn' | 'status'>): PostingListItem {
  return {
    bucketId: null,
    bookingId: null,
    expectedCents: 20_000,
    postedCents: null,
    postedOn: null,
    merchantDescriptor: null,
    note: null,
    bucketLabel: null,
    propertyName: null,
    ...over,
  };
}

function renderTracker(postings: readonly PostingListItem[], bucketOptions: readonly { id: string; label: string }[] = []) {
  return render(
    <ToastProvider>
      <CreditPostingTracker postings={postings} bucketOptions={bucketOptions} />
    </ToastProvider>,
  );
}

describe('CreditPostingTracker — empty state', () => {
  it('says plainly that nothing is outstanding, and renders no list or table', () => {
    const resolved = posting({ id: 'p-posted', chargedOn: daysAgoIso(30), status: 'POSTED', postedCents: 20_000 });
    renderTracker([resolved]);

    expect(screen.getByText(/nothing outstanding right now/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('still offers "log a credit to track" even with nothing outstanding', () => {
    renderTracker([]);
    expect(screen.getByRole('button', { name: 'Log a credit to track' })).toBeInTheDocument();
  });
});

describe('CreditPostingTracker — attention ordering', () => {
  it('surfaces STALE and OVERDUE, sorted most-urgent first, and drops resolved postings', () => {
    const overdue = posting({
      id: 'p-overdue',
      chargedOn: daysAgoIso(20),
      status: 'PENDING',
      bucketLabel: 'The Edit credit · Jan–Jun',
    });
    const stale = posting({
      id: 'p-stale',
      chargedOn: daysAgoIso(80),
      status: 'PENDING',
      bucketLabel: 'Amex hotel credit',
    });
    const resolved = posting({ id: 'p-posted', chargedOn: daysAgoIso(30), status: 'POSTED', postedCents: 20_000 });

    // Deliberately passed out of urgency order — the component does the sorting.
    renderTracker([overdue, stale, resolved]);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Stale');
    expect(rows[1]).toHaveTextContent('Overdue');
    expect(screen.queryByText('Amex hotel credit · Jan–Jun')).not.toBeInTheDocument();
  });

  it('still lists a SETTLING posting (still normal), below the urgent ones', () => {
    const settling = posting({ id: 'p-settling', chargedOn: daysAgoIso(2), status: 'PENDING', bucketLabel: 'Settling one' });
    const overdue = posting({ id: 'p-overdue', chargedOn: daysAgoIso(20), status: 'PENDING', bucketLabel: 'Overdue one' });

    renderTracker([settling, overdue]);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Overdue one');
    expect(rows[1]).toHaveTextContent('Settling one');
    expect(within(rows[1]!).getByText('Settling')).toBeInTheDocument();
  });
});

describe('CreditPostingTracker — chase it', () => {
  it('shows exactly the three facts an issuer\'s chat asks for, and copies them', async () => {
    const user = userEvent.setup();
    const writeTextSpy = spyOnClipboardWrite();
    const overdue = posting({
      id: 'p-overdue',
      chargedOn: daysAgoIso(20),
      status: 'PENDING',
      expectedCents: 25_000,
      merchantDescriptor: 'THE EDIT BY CHASE TRAVEL',
    });
    renderTracker([overdue]);

    await user.click(screen.getByRole('button', { name: 'Chase it' }));

    expect(screen.getByText(/Merchant: THE EDIT BY CHASE TRAVEL/)).toBeInTheDocument();
    expect(screen.getByText(/Amount: \$250\.00/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const copied = writeTextSpy.mock.calls[0]?.[0] as string;
    expect(copied).toContain('Merchant: THE EDIT BY CHASE TRAVEL');
    expect(copied).toContain('Amount: $250.00');
    expect(copied).toMatch(/Charge date: /);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('names an unknown merchant honestly instead of leaving the fact blank', async () => {
    const user = userEvent.setup();
    const overdue = posting({ id: 'p-overdue', chargedOn: daysAgoIso(20), status: 'PENDING', merchantDescriptor: null });
    renderTracker([overdue]);

    await user.click(screen.getByRole('button', { name: 'Chase it' }));
    expect(screen.getByText(/Merchant: not shown on the statement yet/)).toBeInTheDocument();
  });
});

describe('CreditPostingTracker — mark posted / mark missing', () => {
  it('marks a credit posted with the current expected amount and refreshes', async () => {
    const user = userEvent.setup();
    markPostedMock.mockResolvedValue({ ok: true });
    const overdue = posting({ id: 'p-overdue', chargedOn: daysAgoIso(20), status: 'PENDING', expectedCents: 25_000 });
    renderTracker([overdue]);

    await user.click(screen.getByRole('button', { name: 'Mark posted' }));
    await user.click(screen.getByRole('button', { name: 'Confirm posted' }));

    expect(markPostedMock).toHaveBeenCalledTimes(1);
    expect(markPostedMock).toHaveBeenCalledWith('p-overdue', 25_000, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(await screen.findByText('Marked posted')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows the failure inline and does not refresh when marking posted fails', async () => {
    const user = userEvent.setup();
    markPostedMock.mockResolvedValue({ ok: false, message: 'This credit could not be found.' });
    const overdue = posting({ id: 'p-overdue', chargedOn: daysAgoIso(20), status: 'PENDING' });
    renderTracker([overdue]);

    await user.click(screen.getByRole('button', { name: 'Mark posted' }));
    await user.click(screen.getByRole('button', { name: 'Confirm posted' }));

    expect(await screen.findByText('This credit could not be found.')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('marks a credit missing and refreshes', async () => {
    const user = userEvent.setup();
    markMissingMock.mockResolvedValue({ ok: true });
    const overdue = posting({ id: 'p-overdue', chargedOn: daysAgoIso(20), status: 'PENDING' });
    renderTracker([overdue]);

    await user.click(screen.getByRole('button', { name: 'Mark missing' }));

    expect(markMissingMock).toHaveBeenCalledWith('p-overdue');
    expect(await screen.findByText('Flagged as missing')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('disables the mark-missing action once a credit is already flagged', () => {
    const stale = posting({ id: 'p-stale', chargedOn: daysAgoIso(80), status: 'MISSING' });
    renderTracker([stale]);

    expect(screen.getByText('You already flagged this as missing once.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Already flagged missing' })).toBeDisabled();
  });
});

describe('CreditPostingTracker — log a credit to track', () => {
  it('records a new posting from the inline form and refreshes', async () => {
    const user = userEvent.setup();
    recordPostingMock.mockResolvedValue({ ok: true, postingId: 'new-1' });
    renderTracker([]);

    await user.click(screen.getByRole('button', { name: 'Log a credit to track' }));
    await user.type(screen.getByLabelText('Expected amount'), '150');
    fireEvent.change(screen.getByLabelText('Charge date'), { target: { value: '2026-05-01' } });
    await user.type(screen.getByLabelText('Merchant descriptor'), 'AMEX TRAVEL ONLINE');
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));

    expect(recordPostingMock).toHaveBeenCalledWith({
      bucketId: null,
      expectedCents: 15_000,
      chargedOn: '2026-05-01',
      merchantDescriptor: 'AMEX TRAVEL ONLINE',
    });
    expect(await screen.findByText('Now tracking this credit')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('refuses to submit without an expected amount', async () => {
    const user = userEvent.setup();
    renderTracker([]);

    await user.click(screen.getByRole('button', { name: 'Log a credit to track' }));
    await user.click(screen.getByRole('button', { name: 'Start tracking' }));

    expect(recordPostingMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter the expected amount first.')).toBeInTheDocument();
  });
});
