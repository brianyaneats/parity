import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import {
  CurrencyInput,
  parseCurrencyToCents,
  centsToRawString,
  formatCentsForDisplay,
} from '../CurrencyInput';

afterEach(cleanup);

/**
 * §10.1: "component tests for every state of `CurrencyInput` specifically —
 * cover it exhaustively." This file tests the pure parse/format functions
 * directly (fast, exact) and the component's focus/blur wiring on top.
 */

describe('parseCurrencyToCents — accepted formats', () => {
  it('parses a bare integer: "1234"', () => {
    expect(parseCurrencyToCents('1234', false)).toEqual({ ok: true, cents: 123400 });
  });

  it('parses a comma-grouped integer: "1,234"', () => {
    expect(parseCurrencyToCents('1,234', false)).toEqual({ ok: true, cents: 123400 });
  });

  it('parses a full currency string: "$1,234.50"', () => {
    expect(parseCurrencyToCents('$1,234.50', false)).toEqual({ ok: true, cents: 123450 });
  });

  it('parses a plain decimal: "1234.5"', () => {
    expect(parseCurrencyToCents('1234.5', false)).toEqual({ ok: true, cents: 123450 });
  });

  it('parses a leading-dollar decimal with no grouping: "$1234.5"', () => {
    expect(parseCurrencyToCents('$1234.5', false)).toEqual({ ok: true, cents: 123450 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseCurrencyToCents('  1,234.50  ', false)).toEqual({ ok: true, cents: 123450 });
  });
});

describe('parseCurrencyToCents — empty input', () => {
  it('empty string parses to null, not 0', () => {
    expect(parseCurrencyToCents('', false)).toEqual({ ok: true, cents: null });
  });

  it('whitespace-only string parses to null, not 0', () => {
    expect(parseCurrencyToCents('   ', false)).toEqual({ ok: true, cents: null });
  });
});

describe('parseCurrencyToCents — negative handling', () => {
  it('rejects a negative amount by default', () => {
    const result = parseCurrencyToCents('-5', false);
    expect(result).toEqual({ ok: false, reason: 'negative-not-allowed' });
  });

  it('rejects "$-1,234.50" by default (sign after the currency symbol)', () => {
    const result = parseCurrencyToCents('$-1,234.50', false);
    expect(result).toEqual({ ok: false, reason: 'negative-not-allowed' });
  });

  it('accepts a negative amount when allowNegative is true', () => {
    expect(parseCurrencyToCents('-5', true)).toEqual({ ok: true, cents: -500 });
  });

  it('accepts "-$1,234.50" when allowNegative is true', () => {
    expect(parseCurrencyToCents('-$1,234.50', true)).toEqual({ ok: true, cents: -123450 });
  });
});

describe('parseCurrencyToCents — invalid input', () => {
  it.each(['abc', '$', '-', '.', '1.2.3', '1,2,3.4.5'])('rejects %j', (input) => {
    const result = parseCurrencyToCents(input, true);
    expect(result.ok).toBe(false);
  });
});

describe('parseCurrencyToCents — float precision', () => {
  it('parses 0.07 to exactly 7 cents, not 6 or 8 (no float drift)', () => {
    expect(parseCurrencyToCents('0.07', false)).toEqual({ ok: true, cents: 7 });
  });

  it('parses 0.1 to exactly 10 cents', () => {
    expect(parseCurrencyToCents('0.1', false)).toEqual({ ok: true, cents: 10 });
  });

  it('parses 19.99 to exactly 1999 cents', () => {
    expect(parseCurrencyToCents('19.99', false)).toEqual({ ok: true, cents: 1999 });
  });

  it('rounds the classic float-multiply failure case correctly: "1.005" → 101 cents, not 100', () => {
    // `Math.round(1.005 * 100)` is the textbook IEEE-754 trap: it evaluates to
    // 100 because `1.005 * 100 === 100.49999999999999` in a float. This parser
    // never multiplies a float at all, so it gets the mathematically correct
    // answer (round half away from zero on the digit string itself).
    expect(parseCurrencyToCents('1.005', false)).toEqual({ ok: true, cents: 101 });
  });

  it('carries a fraction that rounds up into the next dollar: 12.999 → 1300 cents', () => {
    expect(parseCurrencyToCents('12.999', false)).toEqual({ ok: true, cents: 1300 });
  });

  it('round-trips a large, non-trivial amount exactly: $12,345.67', () => {
    expect(parseCurrencyToCents('$12,345.67', false)).toEqual({ ok: true, cents: 1234567 });
  });
});

describe('centsToRawString', () => {
  it('renders null as an empty string', () => {
    expect(centsToRawString(null)).toBe('');
  });

  it('renders a whole-dollar amount with no fraction', () => {
    expect(centsToRawString(70000)).toBe('700');
  });

  it('renders a two-decimal amount', () => {
    expect(centsToRawString(123450)).toBe('1234.5');
  });

  it('renders single-digit cents with a leading zero preserved', () => {
    expect(centsToRawString(7)).toBe('0.07');
  });

  it('renders a negative amount with a leading minus', () => {
    expect(centsToRawString(-500)).toBe('-5');
  });
});

describe('formatCentsForDisplay', () => {
  it('renders null as an empty string', () => {
    expect(formatCentsForDisplay(null)).toBe('');
  });

  it('formats with a dollar sign, grouping, and two decimals', () => {
    expect(formatCentsForDisplay(123450)).toBe('$1,234.50');
  });

  it('formats single-digit cents padded to two digits', () => {
    expect(formatCentsForDisplay(7)).toBe('$0.07');
  });

  it('formats a negative amount with the sign before the dollar sign', () => {
    expect(formatCentsForDisplay(-500)).toBe('-$5.00');
  });
});

describe('<CurrencyInput /> — component behavior', () => {
  function ControlledCurrencyInput(props: {
    readonly initial?: number | null;
    readonly allowNegative?: boolean;
    readonly onChangeSpy?: (cents: number | null) => void;
  }) {
    const [value, setValue] = React.useState<number | null>(props.initial ?? null);
    return (
      <CurrencyInput
        label="Room total"
        value={value}
        allowNegative={props.allowNegative}
        onChange={(cents) => {
          setValue(cents);
          props.onChangeSpy?.(cents);
        }}
      />
    );
  }

  it('renders a real <label> associated with the input (never placeholder-as-label)', () => {
    render(<ControlledCurrencyInput />);
    const input = screen.getByLabelText('Room total');
    expect(input).toBeInTheDocument();
  });

  it('shows the formatted value when not focused', () => {
    render(<ControlledCurrencyInput initial={123450} />);
    const input = screen.getByLabelText('Room total') as HTMLInputElement;
    expect(input.value).toBe('$1,234.50');
  });

  it('shows the raw value on focus and the formatted value again on blur', async () => {
    const user = userEvent.setup();
    render(<ControlledCurrencyInput initial={123450} />);
    const input = screen.getByLabelText('Room total') as HTMLInputElement;

    await user.click(input);
    expect(input.value).toBe('1234.5');

    await user.tab();
    expect(input.value).toBe('$1,234.50');
  });

  it('commits cents on change as the user types, and the final value is exact', async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledCurrencyInput onChangeSpy={onChangeSpy} />);
    const input = screen.getByLabelText('Room total') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.07' } });

    expect(onChangeSpy).toHaveBeenLastCalledWith(7);
  });

  it('typing then clearing the field returns null, not 0', async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledCurrencyInput initial={0} onChangeSpy={onChangeSpy} />);
    const input = screen.getByLabelText('Room total') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '500' } });
    expect(onChangeSpy).toHaveBeenLastCalledWith(50000);

    fireEvent.change(input, { target: { value: '' } });
    expect(onChangeSpy).toHaveBeenLastCalledWith(null);

    fireEvent.blur(input);
    expect(input.value).toBe('');
  });

  it('rejects a typed negative value when allowNegative is not set: value never goes negative', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledCurrencyInput initial={5000} onChangeSpy={onChangeSpy} />);
    const input = screen.getByLabelText('Room total') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '-50' } });

    expect(onChangeSpy).not.toHaveBeenCalledWith(-5000);
    expect(screen.getByRole('alert')).toHaveTextContent(/negative amounts are not allowed/i);
  });

  it('accepts a typed negative value when allowNegative is set', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledCurrencyInput initial={0} allowNegative onChangeSpy={onChangeSpy} />);
    const input = screen.getByLabelText('Room total') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '-50' } });

    expect(onChangeSpy).toHaveBeenLastCalledWith(-5000);
  });

  it('associates an externally-supplied error via aria-describedby and sets aria-invalid', () => {
    render(
      <CurrencyInput label="Room total" value={null} onChange={() => {}} error="Enter a total." />,
    );
    const input = screen.getByLabelText('Room total');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a total.');
  });

  it('disables the field when disabled is set', () => {
    render(<CurrencyInput label="Room total" value={null} onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Room total')).toBeDisabled();
  });

  it('renders a prefix and a suffix', () => {
    render(
      <CurrencyInput
        label="Room total"
        value={100}
        onChange={() => {}}
        prefix="$"
        suffix="USD"
      />,
    );
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
  });
});
