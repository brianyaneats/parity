import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@/infrastructure/observability/Logger';
import { dependencies, executionContext } from '@/application/runtime';
import { DrizzleAuthRepository } from '@/infrastructure/persistence/repositories/DrizzleAuthRepository';
import { VerifyMagicLinkUseCase } from '@/application/usecases/VerifyMagicLinkUseCase';
import { encodeSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';

/**
 * `GET /api/auth/callback` — this build's own addition, not in §5.2's table.
 *
 * `POST /api/auth/magic-link` emails a link to this exact path; without it,
 * the link goes nowhere and magic-link sign-in — the entire authentication
 * story for this product (§12) — has no way to complete. It cannot use
 * `route()` the way every other route in this task does: `route()` always
 * wraps its handler's return value in `NextResponse.json(...)` (see
 * `src/lib/api/handler.ts`), and this endpoint is reached by a browser
 * following a link from an email — it needs to set a cookie and redirect, not
 * return JSON. `src/app/api/health/route.ts` and `src/app/api/metrics/route.ts`
 * are the existing precedent for a bespoke handler outside `route()` when the
 * response shape genuinely does not fit it; this follows the same pattern,
 * with its own request id, scoped logger, and no stack trace ever reaching
 * the client — any failure just redirects to `/login` with a generic error,
 * never revealing *why* a link failed (§12's account-enumeration concern
 * extends here too: "expired" vs. "wrong token" vs. "unknown email" all look
 * identical from the outside).
 */
export const dynamic = 'force-dynamic';

const authRepository = new DrizzleAuthRepository();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const logger = createLogger().child({ requestId, route: '/api/auth/callback' });
  const url = new URL(request.url);
  const redirectBase = process.env.AUTH_URL || url.origin;

  try {
    const email = url.searchParams.get('email');
    const token = url.searchParams.get('token');
    if (!email || !token) throw ApiError.validation('Missing email or token.');

    const useCase = new VerifyMagicLinkUseCase(dependencies(logger), authRepository);
    const session = await useCase.execute({ email, token }, executionContext('anonymous', requestId));

    const response = NextResponse.redirect(new URL('/compare', redirectBase));
    response.cookies.set(
      SESSION_COOKIE,
      encodeSession({ userId: session.userId, email: session.email }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        // Matches the signed `exp` claim inside the payload — the claim is
        // what is actually enforced; this is the browser-side echo of it.
        maxAge: SESSION_TTL_SECONDS,
      },
    );
    return response;
  } catch (error) {
    logger.info('magic-link verification failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.redirect(new URL('/login?error=invalid_link', redirectBase));
  }
}
