import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConditionList, type ConditionListItem } from '../ConditionList';

afterEach(cleanup);

const ITEMS: readonly ConditionListItem[] = [
  { id: 'a', label: 'Full URL visible', state: 'pass', description: 'Proves the page is reachable.' },
  { id: 'b', label: 'Cancellation policy captured', state: 'fail', description: 'Denied without it.' },
  { id: 'c', label: 'Currency shown', state: 'warn', description: 'Needed to confirm the comparison.' },
];

describe('<ConditionList /> — §6.4 pass/fail/warn rows', () => {
  it('renders every row’s label and description', () => {
    render(<ConditionList items={ITEMS} />);
    expect(screen.getByText('Full URL visible')).toBeInTheDocument();
    expect(screen.getByText('Proves the page is reachable.')).toBeInTheDocument();
    expect(screen.getByText('Cancellation policy captured')).toBeInTheDocument();
    expect(screen.getByText('Currency shown')).toBeInTheDocument();
  });

  it('pairs each state with a screen-reader word, never colour alone (§6.7)', () => {
    render(<ConditionList items={ITEMS} aria-label="Conditions" />);
    expect(screen.getByText('— Done')).toHaveClass('sr-only');
    expect(screen.getByText('— Failed')).toHaveClass('sr-only');
    expect(screen.getByText('— Needs attention')).toHaveClass('sr-only');
  });

  it('renders read-only rows as plain list items, not buttons, when no onToggle is given', () => {
    render(<ConditionList items={ITEMS} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('applies visual emphasis to emphasized rows independent of state', () => {
    const items: readonly ConditionListItem[] = [
      { id: 'x', label: 'High risk', state: 'warn', emphasized: true },
      { id: 'y', label: 'Normal risk', state: 'warn', emphasized: false },
    ];
    render(<ConditionList items={items} />);
    const emphasizedRow = screen.getByText('High risk').closest('li');
    const normalRow = screen.getByText('Normal risk').closest('li');
    expect(emphasizedRow).toHaveClass('border-border-strong');
    expect(normalRow).not.toHaveClass('border-border-strong');
  });

  it('renders as tickable checkbox rows when onToggle is provided, reflecting state via aria-checked', () => {
    render(<ConditionList items={ITEMS} onToggle={() => {}} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true'); // 'pass'
    expect(checkboxes[1]).toHaveAttribute('aria-checked', 'false'); // 'fail'
    expect(checkboxes[2]).toHaveAttribute('aria-checked', 'false'); // 'warn'
  });

  it('calls onToggle with the row id when a tickable row is activated', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ConditionList items={ITEMS} onToggle={onToggle} />);

    await user.click(screen.getByRole('checkbox', { name: /full url visible/i }));
    expect(onToggle).toHaveBeenCalledWith('a');
  });

  it('applies the aria-label to the list for an accessible name', () => {
    render(<ConditionList items={ITEMS} aria-label="Evidence checklist" />);
    expect(screen.getByRole('list', { name: 'Evidence checklist' })).toBeInTheDocument();
  });
});
