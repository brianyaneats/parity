import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';

afterEach(cleanup);

describe('<Button />', () => {
  it.each(['primary', 'secondary', 'ghost', 'destructive'] as const)(
    'renders the %s variant with its accessible name',
    (variant) => {
      render(<Button variant={variant}>Save comparison</Button>);
      expect(screen.getByRole('button', { name: 'Save comparison' })).toBeInTheDocument();
    },
  );

  it('fires onClick when activated', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save comparison</Button>);
    await user.click(screen.getByRole('button', { name: 'Save comparison' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type="button" so it never submits a surrounding form by accident', () => {
    render(<Button>Save comparison</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('is disabled and inert when disabled is set', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save comparison
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save comparison' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  describe('loading state', () => {
    it('is disabled while loading', () => {
      render(<Button loading>Save comparison</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('does not fire onClick while loading', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save comparison
        </Button>,
      );
      await user.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });

    it('keeps its accessible name while loading — the spinner never replaces the label', () => {
      render(<Button loading>Save comparison</Button>);
      expect(screen.getByRole('button', { name: 'Save comparison' })).toBeInTheDocument();
    });

    it('marks itself busy for assistive technology', () => {
      render(<Button loading>Save comparison</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });
  });
});
