import { cookies } from 'next/headers';
import { createHmac } from 'node:crypto';
import { createLogger } from '@/infrastructure/observability/Logger';
import { ApiError } from '@/lib/api/errors';
import { constantTimeEqual } from './constantTimeEqual';

/**
 * Session access.
 *
 * §5.1: "Auth on every route except `/api/health`." §12: Parity never asks for,
 * stores, transmits or proxies a bank, card-issuer or hotel-portal credential —
 * authentication is a magic link to the user's own email address and nothing
 * else. There is no OAuth-shaped workaround and no credential proxying.
 *
 * The `PARITY_DEMO_USER` escape hatch below exists so the app is runnable from
 * a clean clone before an SMTP provider is configured (§0.4 wants local setup
 * in under ten commands). It is refused outright in production.
 *
 * **The cookie is signed.** A session used to be plain base64url JSON — anyone
 * could mint `{"userId": "<anyone>"}` and become that user, including against
 * `DELETE /api/account`. It is now `<base64url JSON>.<signature>`, where the
 * signature is `HMAC-SHA256(payload, AUTH_SECRET)`, base64url-encoded, checked
 * with a constant-time compare (`crypto.timingSafeEqual`) so a byte-by-byte
 * timing difference can't be used to guess it one byte at a time. Without
 * `AUTH_SECRET`: production refuses to issue or accept any session (fail
 * closed — a session nobody can forge is safer than one anybody can); outside
 * production it falls back to a fixed, publicly-known dev secret (logged once)
 * so a clean clone still runs before the developer has configured anything.
 */

export interface Session {
  readonly userId: string;
  readonly email: string;
}

export const SESSION_COOKIE = 'parity-session';

/**
 * Only used when `AUTH_SECRET` is unset outside production. It is public —
 * checked into this file — so it must never be reachable in production; the
 * check in `resolveAuthSecret` is what keeps that true, not obscurity.
 */
const DEV_FALLBACK_SECRET = 'parity-dev-session-secret';

let warnedDevFallback = false;
let loggedMissingProdSecret = false;

function resolveAuthSecret(): string | null {
  const configured = process.env.AUTH_SECRET;
  if (configured) return configured;

  if (process.env.NODE_ENV === 'production') {
    if (!loggedMissingProdSecret) {
      loggedMissingProdSecret = true;
      createLogger().error(
        'AUTH_SECRET is not set in production. Refusing to issue or accept sessions until it is configured.',
      );
    }
    return null;
  }

  if (!warnedDevFallback) {
    warnedDevFallback = true;
    createLogger().warn(
      'AUTH_SECRET is not set; falling back to a fixed development signing secret. Set AUTH_SECRET before deploying (see .env.example).',
    );
  }
  return DEV_FALLBACK_SECRET;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;

  if (raw) {
    const parsed = decodeSession(raw);
    if (parsed) return parsed;
  }

  // Local development only. A misconfigured production deployment must fail
  // closed rather than silently serve one user's data to everyone.
  const demoUser = process.env.PARITY_DEMO_USER;
  if (demoUser && process.env.NODE_ENV !== 'production') {
    return { userId: demoUser, email: 'demo@parity.local' };
  }

  return null;
}

export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) throw ApiError.unauthorized();
  return session;
}

/**
 * Returns `null` for any of: no `AUTH_SECRET` in production, a cookie that
 * isn't exactly `payload.signature`, a signature that doesn't match, or a
 * payload that isn't valid base64url JSON shaped like a `Session`. A
 * malformed or forged cookie is an unauthenticated request, not a server
 * error.
 *
 * Exported (alongside `encodeSession`) so the signing contract — round-trip,
 * tamper detection, wrong-secret rejection — is testable directly, without
 * routing through `getSession()`'s `next/headers` dependency, which needs a
 * live Next.js request scope a unit test doesn't have.
 */
export function decodeSession(raw: string): Session | null {
  const secret = resolveAuthSecret();
  if (!secret) return null;

  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  if (!constantTimeEqual(sign(payload, secret), signature)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'userId' in decoded &&
      typeof (decoded as { userId: unknown }).userId === 'string'
    ) {
      const value = decoded as { userId: string; email?: unknown };
      return {
        userId: value.userId,
        email: typeof value.email === 'string' ? value.email : '',
      };
    }
  } catch {
    // A malformed cookie is an unauthenticated request, not a server error.
  }
  return null;
}

/**
 * Signs a session into the `payload.signature` cookie value. Throws if
 * `AUTH_SECRET` is unset in production — refusing to issue a forgeable (or,
 * worse, unsigned) session is the fail-closed half of the contract; the
 * caller (the magic-link callback route) already wraps this in a try/catch
 * that never leaks *why* sign-in failed to the client.
 */
export function encodeSession(session: Session): string {
  const secret = resolveAuthSecret();
  if (!secret) {
    throw new Error('Cannot issue a session: AUTH_SECRET is not configured in production.');
  }

  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}
