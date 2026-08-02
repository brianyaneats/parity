'use client';

import { cn } from '@/lib/cn';
import { useTheme } from './ThemeProvider';
import { THEME_OPTIONS } from '@/lib/theme';

/**
 * The three-state theme control — §6.2.
 *
 * System / Light / Dark, as a radio group rather than a two-state switch. A
 * switch cannot express "follow my OS", and §6.2 requires that an explicit
 * choice beats the OS setting *in both directions* — which is only meaningful
 * if "no explicit choice" is itself selectable.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <fieldset className={cn('w-full', className)}>
      <legend className="sr-only">Theme</legend>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex rounded-md border border-border p-0.5"
      >
        {THEME_OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(option.value)}
              className={cn(
                'flex-1 rounded-sm px-2 py-1 text-xs',
                'transition-colors duration-fast ease-standard',
                selected
                  ? 'bg-glass text-text-primary'
                  : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
