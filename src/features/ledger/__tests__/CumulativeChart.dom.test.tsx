import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CumulativeChart } from '../CumulativeChart';
import { buildCumulativeSeries, type LedgerAmountEvent } from '../ledger-aggregate';

afterEach(cleanup);

const event = (overrides: Partial<LedgerAmountEvent>): LedgerAmountEvent => ({
  kind: 'CHANNEL_CHOICE',
  amountCents: 1000,
  realized: true,
  occurredOn: '2026-01-01',
  ...overrides,
});

describe('<CumulativeChart /> — §7.7, §8.6', () => {
  it('shows a graceful message instead of a degenerate chart with under two points', () => {
    render(<CumulativeChart points={buildCumulativeSeries([event({})])} />);
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
  });

  it('shows a graceful message with zero points', () => {
    render(<CumulativeChart points={[]} />);
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
  });

  it('distinguishes realized from projected textually via the legend', () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-01-01', amountCents: 1000, realized: true }),
      event({ occurredOn: '2026-01-08', amountCents: 400, realized: false }),
    ]);
    render(<CumulativeChart points={points} />);
    expect(screen.getByText('Realized')).toBeInTheDocument();
    expect(screen.getByText(/Projected/)).toBeInTheDocument();
  });

  it('distinguishes realized from projected visually with two distinct series colours, and no third', () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-01-01', amountCents: 1000, realized: true }),
      event({ occurredOn: '2026-01-08', amountCents: 400, realized: false }),
      event({ occurredOn: '2026-01-15', amountCents: 600, realized: true }),
    ]);
    const { container } = render(<CumulativeChart points={points} />);
    const html = container.innerHTML;

    expect(html).toContain('series-1');
    expect(html).toContain('series-2');
    expect(html).not.toContain('series-3');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });

  it('renders a direct end-of-line label for each series in addition to the legend (§6.5 rule 7)', () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-01-01', amountCents: 100_00, realized: true }),
      event({ occurredOn: '2026-01-08', amountCents: 40_00, realized: false }),
    ]);
    render(<CumulativeChart points={points} />);
    // The last point's cumulative values, rendered as direct on-chart labels
    // (in addition to appearing once more as a y-axis gridline tick, hence
    // `getAllByText` rather than requiring a single unique match).
    expect(screen.getAllByText('$100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$40').length).toBeGreaterThan(0);
  });

  it('exposes the same data as a table behind a disclosure', async () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-01-01', amountCents: 1000, realized: true }),
      event({ occurredOn: '2026-01-08', amountCents: 400, realized: false }),
    ]);
    render(<CumulativeChart points={points} />);
    const toggle = screen.getByRole('button', { name: /view as table/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives every date one keyboard-focusable, accessibly-labelled point', () => {
    const points = buildCumulativeSeries([
      event({ occurredOn: '2026-01-01', amountCents: 1000, realized: true }),
      event({ occurredOn: '2026-01-08', amountCents: 400, realized: false }),
    ]);
    render(<CumulativeChart points={points} />);
    const markers = screen.getAllByRole('img', { name: /realized/i });
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker).toHaveAttribute('tabindex', '0');
    }
  });
});
