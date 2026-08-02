import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BucketMeter } from '../BucketMeter';
import { CreditBucket } from '@/domain/credit/CreditBucket';
import type { Cents } from '@/domain/shared/cents';

afterEach(cleanup);

const CENTS = (n: number) => n as Cents;

/**
 * Same window and day-count fixture `CreditBucket.test.ts` uses for its own
 * band-boundary assertions (§7.5: >60 neutral, 30–60 warning, <30 critical),
 * so this component test independently agrees with the domain test rather
 * than inventing its own dates.
 */
function bucket(over: Partial<Parameters<typeof CreditBucket.create>[0]> = {}): CreditBucket {
  return CreditBucket.create({
    id: 'bucket-1',
    userId: 'user-1',
    cardId: 'card-1',
    key: 'CSR_EDIT_H2',
    label: 'The Edit credit · Jul–Dec',
    faceCents: CENTS(25_000),
    window: { start: '2026-07-01', end: '2026-12-31' },
    consumedCents: CENTS(0),
    ...over,
  });
}

describe('<BucketMeter /> — every state §6.4/§7.5 requires', () => {
  it('renders healthy (>60 days) with an "On track" text label', () => {
    render(<BucketMeter bucket={bucket()} todayIsoDate="2026-08-01" />);
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('renders warning (30–60 days) with an "Expiring soon" text label', () => {
    render(<BucketMeter bucket={bucket()} todayIsoDate="2026-11-15" />);
    expect(screen.getByText('Expiring soon')).toBeInTheDocument();
  });

  it('renders critical (<30 days) with an "Act now" text label', () => {
    render(<BucketMeter bucket={bucket()} todayIsoDate="2026-12-15" />);
    expect(screen.getByText('Act now')).toBeInTheDocument();
  });

  it('renders expired with an "Expired" text label once the window has closed', () => {
    render(<BucketMeter bucket={bucket()} todayIsoDate="2027-01-01" />);
    // The band badge and the days-remaining figure both say "Expired".
    expect(screen.getAllByText('Expired').length).toBeGreaterThanOrEqual(1);
  });

  it('renders exhausted with a "Fully used" text label, even with 152 days still open', () => {
    render(
      <BucketMeter bucket={bucket({ consumedCents: CENTS(25_000) })} todayIsoDate="2026-08-01" />,
    );
    expect(screen.getByText('Fully used')).toBeInTheDocument();
    // Exhausted overrides the date-based band — "On track" must not also appear.
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
  });

  it('renders the required face, consumed, remaining and days-remaining figures — §6.4', () => {
    render(
      <BucketMeter
        bucket={bucket({ consumedCents: CENTS(10_000) })}
        todayIsoDate="2026-08-01"
      />,
    );
    expect(screen.getByText('$250.00')).toBeInTheDocument(); // face
    expect(screen.getByText('$100.00')).toBeInTheDocument(); // consumed
    expect(screen.getByText('$150.00')).toBeInTheDocument(); // remaining
    expect(screen.getByText('152 days')).toBeInTheDocument();
  });
});

describe('<BucketMeter /> — colour is never the sole carrier (§6.7)', () => {
  it.each([
    ['2026-08-01', 'On track'],
    ['2026-11-15', 'Expiring soon'],
    ['2026-12-15', 'Act now'],
    ['2027-01-01', 'Expired'],
  ] as const)('band %s pairs its status colour with the text label %s', (today, label) => {
    render(<BucketMeter bucket={bucket()} todayIsoDate={today} />);
    // The label is a real, queryable text node — not information carried by
    // a colour class alone — and it sits beside a non-decorative glyph. Some
    // labels (e.g. "Expired") also appear in the plain days-remaining figure,
    // so find the specific occurrence that is the badge (paired with an svg).
    const matches = screen.getAllByText(label);
    const badge = matches.map((el) => el.closest('span')).find((el) => el?.querySelector('svg'));
    expect(badge).toBeTruthy();
  });

  it('the exhausted band also pairs its colour with a text label and a glyph', () => {
    render(
      <BucketMeter bucket={bucket({ consumedCents: CENTS(25_000) })} todayIsoDate="2026-08-01" />,
    );
    const badge = screen.getByText('Fully used').closest('span');
    expect(badge).not.toBeNull();
    expect(badge?.querySelector('svg')).toBeTruthy();
  });
});

describe('<BucketMeter /> — window-assumed disclosure', () => {
  it('discloses an assumed window rather than presenting a guess as fact', () => {
    render(
      <BucketMeter
        bucket={bucket({ windowAssumed: true })}
        todayIsoDate="2026-08-01"
      />,
    );
    expect(screen.getByText(/window assumed as the calendar year/i)).toBeInTheDocument();
  });

  it('says nothing about an assumed window when the real date is known', () => {
    render(<BucketMeter bucket={bucket({ windowAssumed: false })} todayIsoDate="2026-08-01" />);
    expect(screen.queryByText(/window assumed/i)).not.toBeInTheDocument();
  });
});
