import type { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/errors';
import { constantTimeEqual } from './constantTimeEqual';

/**
 * Cron authentication — §5.1 ("auth on every route except `/api/health`") and
 * Part 9 ("Authenticate cron routes with the `CRON_SECRET` bearer token").
 *
 * A cron route has no user session — it is invoked by Vercel's scheduler, not
 * a browser — so `requireUser()` does not apply here; this is the equivalent
 * authentication boundary for a system-to-system call. Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is
 * set; this just checks that it matches.
 *
 * The comparison uses the same `constantTimeEqual` helper `session.ts` uses
 * for the session-cookie signature, rather than `!==` — `CRON_SECRET` is a
 * bearer credential exactly like that signature, and a security review that
 * expects a timing-safe compare for one secret and accepts a leaky one for
 * another is a gap waiting to be found, even though this endpoint's
 * exploitability is low (the four cron routes are the only callers, and the
 * secret is high-entropy).
 */
export function requireCronSecret(request: NextRequest): void {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    // Failing closed: an unconfigured secret must never be treated as "no
    // auth required." Local dev sets `CRON_SECRET` in `.env` like every other
    // job-affecting variable (§0.4).
    throw ApiError.unauthorized('CRON_SECRET is not configured.');
  }

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${configured}`;

  if (!constantTimeEqual(expected, header)) {
    throw ApiError.unauthorized();
  }
}

/** `?dry=1` — §9: every job must support a dry run that logs without sending. */
export function isDryRun(request: NextRequest): boolean {
  return new URL(request.url).searchParams.get('dry') === '1';
}
