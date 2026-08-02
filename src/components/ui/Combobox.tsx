'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Command as CommandPrimitive } from 'cmdk';
import { Check, ChevronDown, Loader2, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FOCUS_RING } from './_shared';

/**
 * Combobox — §6.4 required states: closed, open, loading, empty, no-results.
 *
 * Built on cmdk (already a dependency, used by shadcn's own combobox
 * pattern) for the searchable list, and Radix Popover for trigger/content
 * positioning, focus trapping, and Escape-to-close.
 *
 * "empty" (`options` is `[]` — there is nothing to search) is distinct from
 * "no-results" (there are options, but the current query matches none of
 * them). Both are required states and get separate copy.
 *
 * Filtering is done here, explicitly, rather than left to cmdk's own
 * (fuzzy-scored) internal filter — `shouldFilter={false}` is passed
 * unconditionally. Two reasons: it is the only way this component can *know*
 * whether the current query has zero matches (the fact `onCreate` below needs
 * to decide whether to render a create row), and it keeps client-side and
 * server-side search (`onSearchChange`) behaving by the same rule — a plain,
 * case-insensitive substring match on `label`/`sublabel` — rather than one
 * mode being fuzzy and the other exact.
 */
export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly sublabel?: string;
}

export interface ComboboxProps {
  readonly label: string;
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  readonly options: readonly ComboboxOption[];
  /** Provide to drive search server-side; omit to filter `options` client-side. */
  readonly onSearchChange?: (query: string) => void;
  /**
   * §7.3 item 1 / §13.3: "free text creates one inline." Domain-free by
   * design — the primitive knows nothing about properties, it only knows a
   * query produced no matches and offers to hand that text back to the
   * caller. Omit to disable the affordance entirely (the create row never
   * renders without it, regardless of how empty the results are).
   */
  readonly onCreate?: (query: string) => void;
  readonly loading?: boolean;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly noResultsMessage?: string;
  readonly createLabel?: (query: string) => string;
  readonly disabled?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly containerClassName?: string;
}

export const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(function Combobox(
  {
    label,
    value,
    onChange,
    options,
    onSearchChange,
    onCreate,
    loading = false,
    placeholder = 'Select…',
    searchPlaceholder = 'Search…',
    emptyMessage = 'Nothing to search yet.',
    noResultsMessage = 'No matches.',
    createLabel = (query) => `Create “${query}”`,
    disabled = false,
    error,
    hint,
    hideLabel,
    id,
    containerClassName,
  },
  ref,
) {
  const generatedId = React.useId();
  const triggerId = id ?? generatedId;
  const errorId = error ? `${triggerId}-error` : undefined;
  const hintId = hint ? `${triggerId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const selected = options.find((option) => option.value === value);
  const hasNoOptionsAtAll = options.length === 0 && !loading;

  const trimmedQuery = query.trim();
  // Server-driven search (`onSearchChange`) has already filtered `options` by
  // the time they reach here; client-side mode filters the full list itself.
  const visibleOptions = React.useMemo(() => {
    if (onSearchChange || trimmedQuery.length === 0) return options;
    const needle = trimmedQuery.toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.sublabel?.toLowerCase().includes(needle),
    );
  }, [options, onSearchChange, trimmedQuery]);

  const hasNoResultsForQuery = !hasNoOptionsAtAll && !loading && visibleOptions.length === 0;
  const showCreateRow = Boolean(onCreate) && !loading && trimmedQuery.length > 0 && visibleOptions.length === 0;

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <label
        htmlFor={triggerId}
        className={cn('text-xs font-medium text-text-secondary', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverPrimitive.Trigger
          ref={ref}
          id={triggerId}
          type="button"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border',
            'bg-surface-1 px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50',
            FOCUS_RING,
            error && 'border-status-critical',
          )}
        >
          <span className={cn('truncate', !selected && 'text-text-muted')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className="z-50 w-[var(--radix-popper-anchor-width)] overflow-hidden rounded-md border border-border bg-surface-2 text-text-primary shadow-e2"
          >
            <CommandPrimitive shouldFilter={false}>
              <div className="flex items-center gap-2 border-b border-border px-2">
                <Search className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                <CommandPrimitive.Input
                  autoFocus
                  value={query}
                  onValueChange={(next) => {
                    setQuery(next);
                    onSearchChange?.(next);
                  }}
                  placeholder={searchPlaceholder}
                  className="h-9 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
              <CommandPrimitive.List className="max-h-64 overflow-y-auto p-1">
                {loading ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-text-muted">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Loading…
                  </div>
                ) : hasNoOptionsAtAll && !showCreateRow ? (
                  <p className="px-2 py-3 text-sm text-text-muted">{emptyMessage}</p>
                ) : hasNoResultsForQuery && !showCreateRow ? (
                  <p className="px-2 py-3 text-sm text-text-muted">{noResultsMessage}</p>
                ) : null}

                {!loading &&
                  visibleOptions.map((option) => (
                    <CommandPrimitive.Item
                      key={option.value}
                      value={option.value}
                      onSelect={() => {
                        onChange(option.value);
                        setOpen(false);
                        setQuery('');
                      }}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm',
                        'data-[selected=true]:bg-glass-hover',
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{option.label}</span>
                        {option.sublabel ? (
                          <span className="truncate text-xs text-text-muted">{option.sublabel}</span>
                        ) : null}
                      </span>
                      {option.value === value ? (
                        <Check className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
                      ) : null}
                    </CommandPrimitive.Item>
                  ))}

                {/* §7.3 item 1 / §13.3: "free text creates one inline" — a
                    property outside the seeded ~47 used to force a detour to
                    /properties before a comparison could even start. Only
                    ever shown alongside zero real matches, so it can never be
                    mistaken for one of them. */}
                {showCreateRow && onCreate ? (
                  <CommandPrimitive.Item
                    value={`__create__${trimmedQuery}`}
                    onSelect={() => {
                      onCreate(trimmedQuery);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-text-primary',
                      'data-[selected=true]:bg-glass-hover',
                    )}
                  >
                    <Plus className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                    <span className="truncate">{createLabel(trimmedQuery)}</span>
                  </CommandPrimitive.Item>
                ) : null}
              </CommandPrimitive.List>
            </CommandPrimitive>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-status-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
