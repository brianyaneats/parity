import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { CountdownTimer } from '../CountdownTimer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = '2026-07-27T12:00:00Z';

function deadlineAfterMs(ms: number): string {
  return new Date(new Date(NOW).getTime() + ms).toISOString();
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe('<CountdownTimer /> — §6.4, §7.4 band boundaries', () => {
  it('reads safe, well inside six hours', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(7 * HOUR)} now={NOW} />);
    expect(screen.getByText('7h 00m')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('is already warning at exactly six hours — §7.4 reserves green for strictly more than 6h', () => {
    // §7.4 reads "green > 6h, amber 1–6h": six hours exactly is inside the
    // amber range, not above it. The boundary belongs to the more urgent band,
    // which is the right bias for a deadline the user cannot recover from
    // missing.
    render(<CountdownTimer deadline={deadlineAfterMs(6 * HOUR)} now={NOW} />);
    expect(screen.getByText('6h 00m')).toBeInTheDocument();
    expect(screen.getByText('Due soon')).toBeInTheDocument();
  });

  it('just under six hours reads warning', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(6 * HOUR - 1)} now={NOW} />);
    expect(screen.getByText('Due soon')).toBeInTheDocument();
  });

  it('is warning at exactly one hour', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(HOUR)} now={NOW} />);
    expect(screen.getByText('1h 00m')).toBeInTheDocument();
    expect(screen.getByText('Due soon')).toBeInTheDocument();
  });

  it('is critical just under one hour', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(59 * MINUTE)} now={NOW} />);
    expect(screen.getByText('59:00')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('reads expired at exactly zero', () => {
    render(<CountdownTimer deadline={NOW} now={NOW} />);
    // "Expired" is both the countdown text and the band word, so it appears twice.
    expect(screen.getAllByText('Expired')).toHaveLength(2);
  });

  it('clamps a deadline already in the past to expired, never a negative countdown', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(-5 * MINUTE)} now={NOW} />);
    expect(screen.getAllByText('Expired')).toHaveLength(2);
    expect(screen.queryByText(/-/)).not.toBeInTheDocument();
  });

  it('pairs every band with a text word, never colour alone (§6.7)', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(30 * MINUTE)} now={NOW} />);
    const timer = screen.getByRole('timer');
    expect(timer).toHaveAccessibleName(/Urgent.*remaining to submit/);
  });
});

describe('<CountdownTimer /> — live ticking and cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('ticks down by one second per interval fire', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(3000)} now={NOW} />);
    expect(screen.getByText('00:03')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:02')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:01')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getAllByText('Expired')).toHaveLength(2);
  });

  it('stops ticking once it reaches expired — no further interval work needed', () => {
    render(<CountdownTimer deadline={deadlineAfterMs(1000)} now={NOW} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Clamped at zero, not a runaway negative count.
    expect(screen.getAllByText('Expired')).toHaveLength(2);
  });

  it('clears its interval on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = render(<CountdownTimer deadline={deadlineAfterMs(10 * MINUTE)} now={NOW} />);

    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });

  it('does not register an interval at all for an already-expired deadline', () => {
    const setSpy = vi.spyOn(global, 'setInterval');
    render(<CountdownTimer deadline={deadlineAfterMs(-1000)} now={NOW} />);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
