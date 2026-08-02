import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '../EmptyState';

afterEach(cleanup);

describe('<EmptyState />', () => {
  it('renders its one-sentence message', () => {
    render(<EmptyState message="No comparisons saved yet." />);
    expect(screen.getByText('No comparisons saved yet.')).toBeInTheDocument();
  });

  it('renders no action when none is provided', () => {
    render(<EmptyState message="No comparisons saved yet." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders exactly one action button and fires its handler', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        message="No comparisons saved yet."
        action={{ label: 'Start a comparison', onClick }}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0] as HTMLElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders no <svg> or <img> — icon-free per §6.4', () => {
    const { container } = render(
      <EmptyState
        message="No comparisons saved yet."
        action={{ label: 'Start a comparison', onClick: () => {} }}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
