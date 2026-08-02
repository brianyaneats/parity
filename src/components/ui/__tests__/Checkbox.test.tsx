import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../Checkbox';

afterEach(cleanup);

describe('<Checkbox />', () => {
  it('renders unchecked by default', () => {
    render(<Checkbox label="Select all" checked={false} onCheckedChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
  });

  it('renders checked', () => {
    render(<Checkbox label="Select all" checked onCheckedChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeChecked();
  });

  it('renders the indeterminate state with aria-checked="mixed"', () => {
    render(<Checkbox label="Select all" checked="indeterminate" onCheckedChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Select all' });
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(checkbox).toHaveAttribute('data-state', 'indeterminate');
  });

  it('resolves an indeterminate checkbox to checked=true on click, never to "indeterminate"', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="Select all" checked="indeterminate" onCheckedChange={onCheckedChange} />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles checked to unchecked on click', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Select all" checked onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('is disabled and inert when disabled is set', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="Select all" checked={false} onCheckedChange={onCheckedChange} disabled />,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Select all' });
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('associates an optional description for assistive technology', () => {
    render(
      <Checkbox
        label="Select all"
        checked={false}
        onCheckedChange={() => {}}
        description="Applies to every row on this page."
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAccessibleDescription(
      'Applies to every row on this page.',
    );
  });
});
