/**
 * Theme resolution — §6.2.
 *
 * Three states, not two: System / Light / Dark. "The explicit choice always
 * beats the OS setting, both directions" — a user who picks Light on a
 * dark-mode laptop gets Light, and a user who picks Dark on a light-mode laptop
 * gets Dark. Only `system` defers to `prefers-color-scheme`.
 *
 * The preference is persisted to `user_settings.theme` **and** mirrored to a
 * cookie, because the server needs it during SSR to stamp `data-theme` on
 * `<html>` in the first byte it sends. Reading it from the database on every
 * request would work but would put a query in front of first paint;
 * reading it from a cookie costs nothing.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_COOKIE = 'parity-theme';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = Object.freeze([
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]);

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function parseThemeCookie(value: string | undefined): ThemePreference {
  return isThemePreference(value) ? value : 'system';
}

/**
 * Resolves a preference to a concrete theme.
 *
 * `systemPrefersDark` is passed in rather than read from `matchMedia`, so this
 * is callable on the server (where there is no `window`) and testable without
 * a DOM.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * The blocking inline script, used **only** when no cookie is present.
 *
 * With a cookie, the server already knows the answer and stamps `data-theme`
 * server-side — no script, no flash, nothing to hydrate. Without one, the first
 * visit has to ask `matchMedia`, and that has to happen before first paint or
 * the user sees a flash. §6.2 makes "no flash of the wrong theme" an acceptance
 * criterion, so this runs synchronously in `<head>`.
 *
 * It writes the cookie too, so this is the only render that ever needs it.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function(){try{
var d=window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.setAttribute('data-theme', d?'dark':'light');
document.cookie='${THEME_COOKIE}=system;path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax';
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
`.trim();
