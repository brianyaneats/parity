'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  setPreference(next: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside a ThemeProvider.');
  return value;
}

interface ThemeProviderProps {
  readonly initialPreference: ThemePreference;
  readonly initialResolved: ResolvedTheme;
  readonly children: React.ReactNode;
}

/**
 * Client-side theme state, seeded from what the server already resolved.
 *
 * The seeding is the point: the provider never computes the theme on mount, so
 * there is no window in which the DOM disagrees with the server's `data-theme`
 * attribute and no flash to hydrate away (§6.2).
 *
 * The provider only *changes* the attribute in two cases — when the user picks
 * a different option, and when the preference is `system` and the OS setting
 * changes while the page is open.
 */
export function ThemeProvider({
  initialPreference,
  initialResolved,
  children,
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(initialResolved);

  const apply = useCallback((next: ResolvedTheme) => {
    document.documentElement.setAttribute('data-theme', next);
    setResolved(next);
  }, []);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;

      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      apply(resolveTheme(next, prefersDark));

      // Persist to `user_settings.theme` as well as the cookie (§6.2). Fire and
      // forget: the cookie already made the change durable for rendering, so a
      // failed write costs a preference sync, not the user's theme.
      void fetch('/api/settings/theme', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: next }),
      }).catch(() => undefined);
    },
    [apply],
  );

  // Follow the OS only while the preference is `system` — §6.2: "the explicit
  // choice always beats the OS setting, both directions".
  useEffect(() => {
    if (preference !== 'system') return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => apply(event.matches ? 'dark' : 'light');

    query.addEventListener('change', onChange);
    apply(query.matches ? 'dark' : 'light');
    return () => query.removeEventListener('change', onChange);
  }, [preference, apply]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
