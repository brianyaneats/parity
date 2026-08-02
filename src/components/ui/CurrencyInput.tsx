'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { FOCUS_WITHIN_RING } from './_shared';

/**
 * CurrencyInput — §6.4 required states: default, focus, error, disabled,
 * with-prefix, with-suffix, plus the spec's explicit CurrencyInput contract:
 *
 * - Accepts `1234`, `1,234`, `$1,234.50`, `1234.5`.
 * - Stores integer cents. `value`/`onChange` are always cents (`number |
 *   null`), never dollars.
 * - Displays formatted (`$1,234.50`) on blur, raw (`1234.5`) on focus.
 * - Rejects negative amounts unless `allowNegative` is set.
 * - Empty string is `null`, never `0`.
 * - Never loses precision through a float — see the parsing functions below.
 *
 * Every parsing/formatting function is exported and pure so it can be unit
 * tested directly, independent of the component's focus/blur wiring.
 */

export interface CurrencyInputProps {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (cents: number | null) => void;
  readonly allowNegative?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly prefix?: React.ReactNode;
  readonly suffix?: React.ReactNode;
  readonly id?: string;
  readonly name?: string;
  readonly hideLabel?: boolean;
  readonly containerClassName?: string;
  readonly className?: string;
}

type ParseResult =
  | { readonly ok: true; readonly cents: number | null }
  | { readonly ok: false; readonly reason: 'invalid' | 'negative-not-allowed' };

/**
 * Rounds up to three fractional digits into integer cents using only integer
 * arithmetic (string slicing + `parseInt`) — never a float division or
 * multiplication. This is what guarantees a value like `0.07` can't drift
 * the way `Math.round(parseFloat('0.07') * 100)` occasionally does under
 * IEEE-754 for other inputs.
 */
function fractionDigitsToCents(fracDigits: string): number {
  if (fracDigits.length === 0) return 0;
  const padded = `${fracDigits}000`.slice(0, 3);
  const twoDigits = Number.parseInt(padded.slice(0, 2), 10);
  const thirdDigit = Number.parseInt(padded.slice(2, 3), 10);
  return thirdDigit >= 5 ? twoDigits + 1 : twoDigits;
}

/**
 * Parses user-typed currency text into integer cents.
 *
 * Accepts an optional leading `-` (in either position relative to `$`), an
 * optional `$`, thousands commas, and up to any number of fractional digits
 * (rounded to the nearest cent). Whitespace-only or empty input parses to
 * `{ ok: true, cents: null }` — an empty field is "no amount entered", not
 * zero dollars.
 */
export function parseCurrencyToCents(input: string, allowNegative: boolean): ParseResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, cents: null };

  let s = trimmed.replace(/\s+/g, '');
  let negative = false;

  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s.startsWith('$')) {
    s = s.slice(1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/,/g, '');

  if (s === '' || s === '.' || !/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) {
    return { ok: false, reason: 'invalid' };
  }

  const [intPartRaw = '', fracPartRaw = ''] = s.split('.');
  const intPart = intPartRaw === '' ? 0 : Number.parseInt(intPartRaw, 10);

  let fracCents = fractionDigitsToCents(fracPartRaw);
  let dollars = intPart;
  if (fracCents >= 100) {
    fracCents -= 100;
    dollars += 1;
  }

  const magnitude = dollars * 100 + fracCents;

  if (negative) {
    if (!allowNegative) return { ok: false, reason: 'negative-not-allowed' };
    return { ok: true, cents: magnitude === 0 ? 0 : -magnitude };
  }
  return { ok: true, cents: magnitude };
}

/** The raw, editable form shown while focused: a plain number, no `$`, no grouping. */
export function centsToRawString(cents: number | null): string {
  if (cents === null) return '';
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  let fraction = '';
  if (rem !== 0) {
    fraction = rem % 10 === 0 ? `.${rem / 10}` : `.${String(rem).padStart(2, '0')}`;
  }
  return `${negative ? '-' : ''}${dollars}${fraction}`;
}

/** The formatted form shown on blur: `$1,234.50`. Integer math only. */
export function formatCentsForDisplay(cents: number | null): string {
  if (cents === null) return '';
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars.toLocaleString('en-US')}.${rem}`;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    {
      label,
      value,
      onChange,
      allowNegative = false,
      error,
      hint,
      disabled,
      required,
      placeholder,
      prefix = '$',
      suffix,
      id,
      name,
      hideLabel,
      containerClassName,
      className,
    },
    ref,
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    const [focused, setFocused] = React.useState(false);
    const [displayValue, setDisplayValue] = React.useState(() => formatCentsForDisplay(value));
    const [internalError, setInternalError] = React.useState<string | undefined>(undefined);

    React.useEffect(() => {
      if (!focused) setDisplayValue(formatCentsForDisplay(value));
    }, [value, focused]);

    const handleFocus = () => {
      setFocused(true);
      setDisplayValue(centsToRawString(value));
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setDisplayValue(next);

      const result = parseCurrencyToCents(next, allowNegative);
      if (!result.ok) {
        setInternalError(
          result.reason === 'negative-not-allowed'
            ? 'Negative amounts are not allowed here.'
            : undefined,
        );
        return;
      }
      setInternalError(undefined);
      onChange(result.cents);
    };

    const handleBlur = () => {
      setFocused(false);
      const result = parseCurrencyToCents(displayValue, allowNegative);
      const resolved = result.ok ? result.cents : value;

      if (!result.ok) {
        setInternalError(
          result.reason === 'negative-not-allowed'
            ? 'Negative amounts are not allowed here.'
            : 'Enter a valid amount.',
        );
      } else {
        setInternalError(undefined);
        onChange(resolved);
      }
      setDisplayValue(formatCentsForDisplay(resolved));
    };

    const effectiveError = error ?? internalError;
    const errorId = effectiveError ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

    return (
      <div className={cn('flex flex-col gap-1', containerClassName)}>
        <label
          htmlFor={inputId}
          className={cn('text-xs font-medium text-text-secondary', hideLabel && 'sr-only')}
        >
          {label}
        </label>
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3',
            FOCUS_WITHIN_RING,
            effectiveError && 'border-status-critical',
            disabled && 'opacity-50',
          )}
        >
          {prefix ? (
            <span className="shrink-0 text-sm text-text-muted" aria-hidden="true">
              {prefix}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            name={name}
            type="text"
            inputMode="decimal"
            value={displayValue}
            onFocus={handleFocus}
            onChange={handleChange}
            onBlur={handleBlur}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            aria-invalid={effectiveError ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              'tnum h-9 w-full flex-1 bg-transparent text-sm text-text-primary outline-none',
              'placeholder:text-text-muted disabled:cursor-not-allowed',
              className,
            )}
          />
          {suffix ? (
            <span className="shrink-0 text-sm text-text-muted" aria-hidden="true">
              {suffix}
            </span>
          ) : null}
        </div>
        {effectiveError ? (
          <p id={errorId} role="alert" className="text-xs text-status-critical">
            {effectiveError}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
