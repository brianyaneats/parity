import type { BrowserContext } from '@playwright/test';
import { BASE_URL, WORKER_EMAIL, WORKER_USER_ID } from './constants';
import { encodeSession, SESSION_COOKIE as REAL_SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Re-exported rather than redefined: this used to be a literal duplicated
 * here because importing `src/lib/auth/session.ts` was believed to fail
 * outside a Next.js request context (that file opens with
 * `import { cookies } from 'next/headers'`). It doesn't — `next/headers`
 * only throws when `cookies()` itself is *called* outside a request scope,
 * and this file never calls `getSession()`, only `encodeSession()`, which
 * touches no request state. Importing the real module means a cookie-format
 * change (base64url shape, then the HMAC signature added to fix the
 * forgeable-session defect) can't silently desync this suite from the app —
 * there is now exactly one `encodeSession`.
 */
export const SESSION_COOKIE = REAL_SESSION_COOKIE;

/**
 * `AUTH_SECRET`, read the same way `src/lib/auth/session.ts` reads it: if
 * set, use it; otherwise `encodeSession()` itself falls back to the same
 * fixed dev secret that file uses when `NODE_ENV !== 'production'` (which is
 * how this Playwright test-runner process — a separate `node` process from
 * the `next start` server under test — is running, even though that server
 * process has `NODE_ENV` forced to `'production'`). Nothing to duplicate
 * here: the fallback lives in `encodeSession` itself, this comment just
 * explains why no `AUTH_SECRET` needs to be exported for a local run.
 */

/**
 * Signs in as the seeded demo account (`pnpm db:seed`) by setting the real
 * session cookie directly — see `e2e/support/constants.ts` for why this, and
 * not the `PARITY_DEMO_USER` dev fixture, is this suite's auth strategy.
 *
 * Call once per `BrowserContext` (a fresh context per test, per Playwright's
 * default) before navigating anywhere that requires a session.
 */
export async function signInAsDemoUser(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      // This worker's own fixture account (see `constants.ts`) — signing in
      // as a per-worker user is what keeps one spec's reset from deleting a
      // sibling spec's data mid-test.
      value: encodeSession({ userId: WORKER_USER_ID, email: WORKER_EMAIL }),
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
