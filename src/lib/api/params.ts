import type { NextRequest } from 'next/server';
import { ApiError } from './errors';

/**
 * Reads a dynamic route segment (e.g. the `:id` in `/api/comparisons/:id`)
 * from the request URL itself.
 *
 * `route()` (`src/lib/api/handler.ts`, out of scope to change for this task)
 * wraps a handler as `(request: NextRequest) => Promise<NextResponse>` —
 * one argument. Next.js's App Router actually invokes a route file's
 * exported `GET`/`PATCH`/`DELETE` as `(request, { params })`, but because
 * `route()`'s returned function only declares the first parameter, the
 * second one Next.js passes is simply never forwarded into `RouteContext`.
 * Every dynamic route in this task therefore reads its `:id` straight out of
 * `request.url` instead of `context.params`, by locating the segment that
 * immediately follows a known, stable ancestor segment — resilient to
 * whatever comes after it in the path (`/recompute`, `/evidence`, …).
 */
export function pathParam(request: NextRequest, afterSegment: string, label = afterSegment): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const at = segments.indexOf(afterSegment);
  const value = at >= 0 ? segments[at + 1] : undefined;
  if (!value) {
    throw ApiError.validation(`Missing ${label} id in the request path.`);
  }
  return decodeURIComponent(value);
}
