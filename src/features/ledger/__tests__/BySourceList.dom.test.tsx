import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BySourceList } from '../BySourceList';
import { buildSourceBreakdown, SOURCE_DEFINITIONS, type LedgerAmountEvent } from '../ledger-aggregate';

afterEach(cleanup);

const event = (overrides: Partial<LedgerAmountEvent>): LedgerAmountEvent => ({
  kind: 'CHANNEL_CHOICE',
  amountCents: 1000,
  realized: true,
  occurredOn: '2026-01-01',
  ...overrides,
});

describe('<BySourceList /> — §7.7, §13.3', () => {
  it('renders all six sources, even with no events at all', () => {
    render(<BySourceList rows={buildSourceBreakdown([])} />);
    for (const def of SOURCE_DEFINITIONS) {
      expect(screen.getByText(def.label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('renders all six sources when every source has events', () => {
    const events = SOURCE_DEFINITIONS.map((def, i) =>
      event({ kind: def.kind, amountCents: (i + 1) * 1000, realized: i % 2 === 0 }),
    );
    render(<BySourceList rows={buildSourceBreakdown(events)} />);
    for (const def of SOURCE_DEFINITIONS) {
      expect(screen.getByText(def.label)).toBeInTheDocument();
    }
  });

  it('never introduces a fourth chart colour — only --series-1 and --series-2 appear', () => {
    const events = SOURCE_DEFINITIONS.map((def, i) =>
      event({ kind: def.kind, amountCents: (i + 1) * 1000, realized: i % 2 === 0 }),
    );
    const { container } = render(<BySourceList rows={buildSourceBreakdown(events)} />);
    const html = container.innerHTML;

    expect(html).toContain('series-1');
    expect(html).toContain('series-2');
    // §6.5 rule 1: a three-series cap, and this list stays at two — the six
    // categories are told apart by row label and rank, never by a third hue.
    expect(html).not.toContain('series-3');
    // No raw colour literal snuck in as an escape hatch around the tokens.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(/);
  });

  it('distinguishes realized from projected both textually and visually', () => {
    const { container } = render(<BySourceList rows={buildSourceBreakdown([])} />);
    // Textually: the legend spells out both words plainly.
    expect(screen.getByText('Realized')).toBeInTheDocument();
    expect(screen.getByText(/Projected/)).toBeInTheDocument();
    // Visually: two distinct colour classes back those two words, not one
    // shared class doing double duty.
    expect(container.innerHTML).toContain('bg-series-1');
    expect(container.innerHTML).toContain('bg-series-2');
  });

  it('ranks the list by total descending', () => {
    const rows = buildSourceBreakdown([
      event({ kind: 'PERK', amountCents: 200 }),
      event({ kind: 'BRG', amountCents: 9000 }),
    ]);
    render(<BySourceList rows={rows} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Best-rate guarantee');
  });
});
