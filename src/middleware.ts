import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/session-constants';

/**
 * Route-level auth redirect — the outermost of three layers (§5.1).
 *
 * This is a router, not a guard. It runs on the Edge runtime, where
 * `node:crypto` is unavailable, so it checks only that a session cookie is
 * *present* — signature verification happens in `getSession()`
 * (`src/lib/auth/session.ts`) on every server render, and the data layer
 * additionally requires a `userId` on every scoped query. A forged cookie
 * gets past this file and no further; what this file buys is that an
 * unauthenticated visitor is redirected to `/login` before any server
 * component runs, instead of each page discovering it independently.
 *
 * `PARITY_DEMO_USER` (dev only — `getSession()` refuses it in production)
 * authenticates without a cookie, so its presence must also let requests
 * through; the session layer still decides whether it counts.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const hasDemoEscapeHatch =
    Boolean(process.env.PARITY_DEMO_USER) && process.env.NODE_ENV !== 'production';

  if (hasSessionCookie || hasDemoEscapeHatch) {
    return NextResponse.next();
  }

  const login = new URL('/login', request.url);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except: /login itself, the API tier (each route enforces its
  // own auth via `requireUser()`/`requireCronSecret` and must keep returning
  // §5.1 JSON envelopes rather than HTML redirects), Next internals, and
  // static assets.
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webp)).*)'],
};
