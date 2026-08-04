import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * `POST /api/auth/logout` — companion to the callback route's cookie-set.
 *
 * Like `/api/auth/callback`, this cannot use `route()`: it exists to mutate
 * a cookie, not to return a §5.1 JSON envelope. Clearing means overwriting
 * with an immediately-expiring empty value — deleting a cookie is just
 * setting it with `maxAge: 0` and the same attributes it was created with.
 *
 * POST, not GET: a logout that works via GET can be triggered by any
 * `<img src>` on any page the user visits (classic CSRF-by-prefetch), and
 * `sameSite: 'lax'` only protects unsafe methods on cross-site requests.
 *
 * The signed session value is stateless, so "log out" removes the browser's
 * copy rather than revoking it server-side; the `exp` claim bounds how long
 * a copied value could outlive this. Server-side revocation (the `sessions`
 * table) remains future work and is tracked in DECISIONS.md.
 */
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
