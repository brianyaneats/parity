import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui';
import { ClaimKit, type ClaimKitData } from '../ClaimKit';

/**
 * The kit now persists every transition through `PATCH /api/claims/:id` before
 * it advances local state — it deliberately will NOT move the UI on a failed
 * save, because the old behaviour (mutate in memory, toast success, never
 * reach the server) is precisely the defect these tests were rewritten to
 * prevent. So a stubbed `fetch` is part of the contract under test, not
 * scaffolding: `assertPersisted` proves the request was actually made.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
});

/** Asserts the UI actually called the API for a given status transition. */
function assertPersisted(status: string) {
  const call = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).startsWith('/api/claims/') &&
      (init as RequestInit | undefined)?.method === 'PATCH' &&
      String((init as RequestInit | undefined)?.body ?? '').includes(`"status":"${status}"`),
  );
  expect(call, `expected a PATCH persisting status ${status}`).toBeDefined();
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.useRealTimers();
});

function renderKit(data: ClaimKitData) {
  return render(
    <ToastProvider>
      <ClaimKit data={data} />
    </ToastProvider>,
  );
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * `ClaimKit` has no injectable clock — `pastDeadline` is gated off a real
 * `new Date()` read at mount (see `ClaimKit.tsx`'s `nowTick` state), unlike
 * `ClaimQueue`, which takes an explicit `now` prop for exactly this reason.
 * A fixture with a hardcoded absolute `deadlineAt` therefore has a shelf
 * life: `2026-07-28T12:00:00Z` was already in the past by the time this
 * suite ran, which made the component correctly (and misleadingly) report
 * the claim as expired. Deriving `bookedAt`/`deadlineAt` from the real
 * "now" at test time — still exactly 24h apart, per §7.4's "deadline_at = T
 * + 24h" rule — keeps "still inside its window" true no matter when the
 * suite runs.
 */
function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

function baseData(overrides: Partial<ClaimKitData> = {}): ClaimKitData {
  return {
    id: 'claim-1',
    userId: 'user-1',
    bookingId: 'booking-1',
    kind: 'CHASE_PM',
    status: 'ELIGIBLE',
    deadlineAt: iso(12 * HOUR_MS),
    claimedGapCents: 14_947,
    awardedCents: null,
    submittedAt: null,
    resolvedAt: null,
    denialReason: null,
    notes: null,
    competingRateId: 'rate-1',

    hotelName: 'Four Seasons Otemachi',
    hotelAddress: '1-2-1 Otemachi, Chiyoda City, Tokyo',
    checkIn: '2026-09-14',
    checkOut: '2026-09-17',
    nights: 3,
    roomType: 'Deluxe King',
    bedType: 'King',
    guestCount: 2,
    currency: 'USD',
    cancellationPolicy: 'Fully refundable until 3 days before check-in',
    bookingChannelLabel: 'Chase The Edit',
    bookedAt: iso(-12 * HOUR_MS),
    ownTotalCents: 354_000,
    ownBaseCents: 314_947,

    competitor: {
      baseCents: 300_000,
      totalCents: 336_000,
      siteDomain: 'fourseasons.com',
      url: 'https://www.fourseasons.com/otemachi/',
    },
    ...overrides,
  };
}

describe('<ClaimKit /> — §7.4 checklist-first order', () => {
  it('leads with a prominent countdown showing the exact deadline in the resolved timezone', () => {
    renderKit(baseData());
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText(/Submit before/)).toBeInTheDocument();
  });

  it('renders all ten evidence items as tickable rows, with the two highRisk rows emphasised', () => {
    renderKit(baseData());
    const checklist = screen.getByRole('list', { name: 'Evidence checklist' });
    const items = within(checklist).getAllByRole('checkbox');
    expect(items).toHaveLength(10);

    const cancellationRow = screen.getByText('The cancellation policy, in full').closest('li');
    expect(cancellationRow?.querySelector('button')).toHaveClass('border-border-strong');
  });

  it('ticks an evidence item on click and updates the done count', async () => {
    const user = userEvent.setup();
    renderKit(baseData());
    expect(screen.getByText('0 of 10')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /full url visible in the address bar/i }));
    expect(screen.getByText('1 of 10')).toBeInTheDocument();
  });

  it('generates claim text stating the hotel, dates and both base rates once a competing rate exists', () => {
    renderKit(baseData());
    const pre = screen.getByText(/Price-match request/);
    expect(pre.textContent).toContain('Four Seasons Otemachi');
    expect(pre.textContent).toContain('2026-09-14');
    expect(pre.textContent).toContain('$3,149.47'); // own base total
    expect(pre.textContent).toContain('$3,000.00'); // competitor base total
    expect(pre.textContent?.toLowerCase()).not.toContain('guarantee');
  });

  it('prompts for a competing rate instead of generating text when none is attached', () => {
    renderKit(baseData({ competitor: null }));
    expect(screen.getByText(/no competing rate attached/i)).toBeInTheDocument();
  });

  it('offers "Mark submitted" for an eligible claim still inside its window', () => {
    renderKit(baseData());
    expect(screen.getByRole('button', { name: 'Mark submitted' })).toBeEnabled();
  });

  it('does NOT offer "Mark submitted" once the deadline has passed — §7.4 acceptance criterion', () => {
    renderKit(baseData({ deadlineAt: '2020-01-01T00:00:00Z' }));
    expect(screen.queryByRole('button', { name: 'Mark submitted' })).not.toBeInTheDocument();
    expect(screen.getByText(/submission window has closed/i)).toBeInTheDocument();
  });

  it('moves an eligible claim to SUBMITTED and then reveals the outcome recorder', async () => {
    const user = userEvent.setup();
    renderKit(baseData());

    await user.click(screen.getByRole('button', { name: 'Mark submitted' }));

    expect(await screen.findByText('Submitted')).toBeInTheDocument();

    // The defect this guards against: the old kit toasted success without
    // ever reaching the server, so the claim silently auto-expired at
    // T+24h while the user believed it was filed.
    assertPersisted('SUBMITTED');
    expect(screen.getByRole('radio', { name: 'Partially approved' })).toBeInTheDocument();
    // The state machine enforcement means the button itself is now gone.
    expect(screen.queryByRole('button', { name: 'Mark submitted' })).not.toBeInTheDocument();
  });

  it('records a partial approval with an awarded amount and reflects it as resolved', async () => {
    const user = userEvent.setup();
    renderKit(baseData({ status: 'SUBMITTED', submittedAt: '2026-07-27T13:00:00Z' }));

    const amountInput = screen.getByLabelText('Amount awarded');
    await user.type(amountInput, '100');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Record outcome' }));

    expect(await screen.findByText(/resolved partially approved/i)).toBeInTheDocument();

    // The defect this guards against: the old kit toasted success without
    // ever reaching the server, so the claim silently auto-expired at
    // T+24h while the user believed it was filed.
    assertPersisted('PARTIAL');
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('records a denial with a reason', async () => {
    const user = userEvent.setup();
    renderKit(baseData({ status: 'SUBMITTED', submittedAt: '2026-07-27T13:00:00Z' }));

    await user.click(screen.getByRole('radio', { name: 'Denied' }));
    await user.type(screen.getByLabelText('Denial reason'), 'Competing rate was member-only.');
    await user.click(screen.getByRole('button', { name: 'Record outcome' }));

    expect(await screen.findByText(/Denied — Competing rate was member-only\./)).toBeInTheDocument();

    // The defect this guards against: the old kit toasted success without
    // ever reaching the server, so the claim silently auto-expired at
    // T+24h while the user believed it was filed.
    assertPersisted('DENIED');
  });

  it('carries the quiet note that partial approval is common and the figure is an estimate', () => {
    renderKit(baseData());
    expect(screen.getByText(/partial approval is common/i)).toBeInTheDocument();
  });
});

describe('<ClaimKit /> — screenshot check (§7.4 item 3)', () => {
  const OriginalImage = globalThis.Image;
  // Read by the fake `Image` below at construction time. A closure captured
  // per-class-declaration (rather than a shared mutable prototype field)
  // sidesteps instance fields shadowing anything written to the prototype.
  let mockWidth = 0;
  let mockHeight = 0;

  beforeEach(() => {
    mockWidth = 0;
    mockHeight = 0;

    // jsdom doesn't decode real images. A fake `Image` lets the width/height
    // check run against fixture dimensions without a real file.
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_value: string) {
        this.naturalWidth = mockWidth;
        this.naturalHeight = mockHeight;
        queueMicrotask(() => this.onload?.());
      }
    }
    // @ts-expect-error -- test double, not a full Image implementation.
    globalThis.Image = FakeImage;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
  });

  it('passes a screenshot at least 1000px wide', async () => {
    const user = userEvent.setup();
    mockWidth = 1600;
    mockHeight = 900;

    renderKit(baseData());
    const file = new File(['x'], 'rate.png', { type: 'image/png' });
    const input = screen.getByLabelText(/upload a screenshot/i);
    await user.upload(input, file);

    expect(await screen.findByText(/1600×900px/)).toBeInTheDocument();
    expect(screen.getByText(/meets the 1000px minimum width/i)).toBeInTheDocument();
  });

  it('warns when a wide, short screenshot looks like a cropped strip', async () => {
    const user = userEvent.setup();
    mockWidth = 1600;
    mockHeight = 200;

    renderKit(baseData());
    const file = new File(['x'], 'rate.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), file);

    expect(await screen.findByText(/looks like a cropped strip/i)).toBeInTheDocument();
  });

  it('fails a screenshot narrower than 1000px', async () => {
    const user = userEvent.setup();
    mockWidth = 400;
    mockHeight = 300;

    renderKit(baseData());
    const file = new File(['x'], 'rate.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), file);

    expect(await screen.findByText(/needs to be at least 1000px wide/i)).toBeInTheDocument();
  });
});
