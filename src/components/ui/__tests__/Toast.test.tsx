import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast, ToastProvider, useToast } from '../Toast';

afterEach(cleanup);

describe('<Toast /> (presentational)', () => {
  it.each(['info', 'success', 'warning', 'error'] as const)('renders the %s variant', (variant) => {
    render(<Toast title="Claim submitted" variant={variant} />);
    expect(screen.getByText('Claim submitted')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an optional description', () => {
    render(<Toast title="Claim submitted" description="We'll notify you when it resolves." />);
    expect(screen.getByText("We'll notify you when it resolves.")).toBeInTheDocument();
  });

  it('renders a dismiss control with an accessible name and calls onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Toast title="Claim submitted" onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

function ToastTrigger() {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast({ title: 'Bucket about to expire', variant: 'warning' })}>
      Trigger
    </button>
  );
}

describe('<ToastProvider /> / useToast()', () => {
  it('renders a toast inside a live region when toast() is called', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Bucket about to expire');
    expect(status.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });

  it('auto-dismisses a toast after its duration elapses', () => {
    vi.useFakeTimers();

    function TriggerWithDuration() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => toast({ title: 'Saved', durationMs: 1000 })}
        >
          Trigger
        </button>
      );
    }

    render(
      <ToastProvider>
        <TriggerWithDuration />
      </ToastProvider>,
    );

    // fireEvent (not user-event) here: user-event's internal timers conflict
    // with vitest's fake timers, so plain DOM events are used for this one
    // interaction to keep the fake clock authoritative.
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('throws a clear error when useToast is called outside a ToastProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken() {
      useToast();
      return null;
    }
    expect(() => render(<Broken />)).toThrow(/useToast must be used inside a ToastProvider/);
    consoleError.mockRestore();
  });
});
