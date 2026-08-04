import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CreditWallet } from '../CreditWallet';
import type { BucketRow } from '../types';

/**
 * Honest cards gating — Feature B, item 2. `/settings`' `CardsSection` lets a
 * caller declare which cards they hold; these tests cover the read side
 * (`CreditWallet`'s new `activeCardKinds` prop): both cards' sections when
 * nothing is configured (today's founding assumption, and what the seeded
 * demo account still shows), only the held card's section otherwise, plus
 * the muted disclosure naming why a section went missing.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

const TODAY = '2026-03-15';

const bucket = (over: Partial<BucketRow> & Pick<BucketRow, 'id' | 'key' | 'label'>): BucketRow => ({
  userId: 'u1',
  cardId: null,
  faceCents: 30_000,
  windowStart: '2026-01-01',
  windowEnd: '2026-06-30',
  consumedCents: 0,
  windowAssumed: false,
  ...over,
});

const BUCKETS: readonly BucketRow[] = [
  bucket({ id: 'amex-1', key: 'AMEX_HOTEL_H1', label: 'Amex hotel credit · Jan–Jun', faceCents: 30_000 }),
  bucket({ id: 'csr-1', key: 'CSR_EDIT_H1', label: 'The Edit credit · Jan–Jun', faceCents: 25_000 }),
];

describe('CreditWallet — honest cards gating', () => {
  it('shows both card sections when nothing is configured', () => {
    render(
      <CreditWallet
        buckets={BUCKETS}
        comparisons={[]}
        todayIsoDate={TODAY}
        isLive
        activeCardKinds={[]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Amex Platinum' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chase Sapphire Reserve' })).toBeInTheDocument();
    expect(screen.queryByText(/Cards you don.t hold are hidden/)).not.toBeInTheDocument();
  });

  it('hides the Amex section and shows the settings hint when only CSR is configured', () => {
    render(
      <CreditWallet
        buckets={BUCKETS}
        comparisons={[]}
        todayIsoDate={TODAY}
        isLive
        activeCardKinds={['CSR']}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Amex Platinum' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chase Sapphire Reserve' })).toBeInTheDocument();

    const hint = screen.getByText(/Cards you don.t hold are hidden/);
    expect(hint).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('shows both sections, with no hint, when every card is configured', () => {
    render(
      <CreditWallet
        buckets={BUCKETS}
        comparisons={[]}
        todayIsoDate={TODAY}
        isLive
        activeCardKinds={['AMEX_PLATINUM', 'CSR']}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Amex Platinum' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chase Sapphire Reserve' })).toBeInTheDocument();
    expect(screen.queryByText(/Cards you don.t hold are hidden/)).not.toBeInTheDocument();
  });
});
