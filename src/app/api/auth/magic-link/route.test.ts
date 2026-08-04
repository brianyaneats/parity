import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { IP_MUTATION_LIMIT_PER_MINUTE } from '@/lib/api/rate-limit';

/**
 * `POST /api/auth/magic-link` — defect 2's fix, exercised through the real
 * `route()` wrapper, not just the `enforceIpRateLimit` primitive (that has
 * its own unit coverage in `src/lib/api/rate-limit.test.ts`). This is the
 * one endpoint the wrapper's new per-IP budget exists for: it is
 * unauthenticated by nature (§5.2 — sign-in has to start somewhere) and
 * sends email to any address a caller supplies, so before this fix it had
 * zero throttling — an email-bombing vector, and it burns Resend quota.
 *
 * §5.2 also requires an identical response for a known and an unknown
 * email, to avoid account enumeration; the second requirement here is that
 * the new 429 doesn't regress that — a rate-limited response must look the
 * same regardless of whether the address exists, same as a 200 does.
 */

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => null,
  requireUser: async () => {
    throw new Error('requireUser should not be called by this unauthenticated route');
  },
}));

// No real Postgres in this test tier (`component`, per package.json/CI) — a
// fake repository keyed on the email itself, so one mock serves both the
// known- and unknown-address cases a single test compares directly.
// `findOrCreateUserByEmail` mirrors the real sign-up-on-request behavior:
// an unknown address gets a user, same as production.
vi.mock('@/infrastructure/persistence/repositories/DrizzleAuthRepository', () => ({
  DrizzleAuthRepository: class {
    async findUserByEmail(email: string) {
      return email === 'known@parity.local' ? { id: 'user-1', email } : null;
    }
    async findOrCreateUserByEmail(email: string) {
      return email === 'known@parity.local' ? { id: 'user-1', email } : { id: 'user-new', email };
    }
    async createVerificationToken(): Promise<void> {}
    async consumeVerificationToken(): Promise<boolean> {
      return false;
    }
  },
}));

// `createNotifier` (used for real below — not under test here) wraps sends
// in `DurableIdempotentNotifier`, which depends on
// `DrizzleNotificationsSentRepository`, which imports `../db` — and that
// module builds its Postgres client at *import time*, throwing immediately
// when `DATABASE_URL` is unset. Mocked for the same reason as
// `DrizzleAuthRepository` above: this test tier has no real Postgres.
vi.mock('@/infrastructure/persistence/repositories/DrizzleNotificationsSentRepository', () => ({
  DrizzleNotificationsSentRepository: class {
    async tryClaim() {
      return { id: 'notification-1' };
    }
  },
}));

// Same reasoning as the two mocks above — `DrizzleEmailBudgetRepository`
// imports `../db` too. Always allows: this file's tests are about the
// per-IP rate limiter and the anti-enumeration response shape, not the
// email send budget, which has its own dedicated coverage in
// `RequestMagicLinkUseCase.test.ts` (in-memory fake, no DB needed there
// either) and `DrizzleEmailBudgetRepository.integration.test.ts` (real
// Postgres, run separately per `package.json`'s `integration` script).
vi.mock('@/infrastructure/persistence/repositories/DrizzleEmailBudgetRepository', () => ({
  DrizzleEmailBudgetRepository: class {
    async reserveSend() {
      return { allowed: true };
    }
  },
}));

const { POST } = await import('./route');

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'error');
});

function request(email: string, ip: string, requestId?: string): NextRequest {
  return new Request('http://localhost:3000/api/auth/magic-link', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
    body: JSON.stringify({ email }),
  }) as unknown as NextRequest;
}

describe('POST /api/auth/magic-link — anti-enumeration', () => {
  it('responds identically for a known and an unknown email address', async () => {
    const ip = '203.0.113.10';

    const known = await POST(request('known@parity.local', ip, 'req-a'));
    const unknown = await POST(request('unknown-nobody@parity.local', ip, 'req-a'));

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
  });
});

describe('POST /api/auth/magic-link — per-IP rate limit (defect 2)', () => {
  it('allows requests up to the per-minute budget', async () => {
    const ip = '203.0.113.20';

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      const response = await POST(request(`caller-${i}@parity.local`, ip));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
  });

  it('returns 429 with the §5.1 error envelope once the per-IP budget is exceeded', async () => {
    const ip = '203.0.113.30';

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      const response = await POST(request(`caller-${i}@parity.local`, ip));
      expect(response.status).toBe(200);
    }

    const blocked = await POST(request('one-too-many@parity.local', ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('x-request-id')).toBeTruthy();

    const body = (await blocked.json()) as {
      error: { code: string; message: string; requestId?: string };
    };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toMatch(/too many/i);
    expect(body.error.requestId).toBe(blocked.headers.get('x-request-id'));
  });

  it('a 429 looks identical whether or not the blocked request was for a real email', async () => {
    const ip = '203.0.113.40';

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      await POST(request(`caller-${i}@parity.local`, ip));
    }

    const blockedKnown = await POST(request('known@parity.local', ip, 'req-fixed'));
    const blockedUnknown = await POST(request('unknown-nobody@parity.local', ip, 'req-fixed'));

    expect(blockedKnown.status).toBe(429);
    expect(blockedUnknown.status).toBe(429);
    expect(await blockedKnown.json()).toEqual(await blockedUnknown.json());
  });

  it('does not share a budget with a different caller IP', async () => {
    const exhaustedIp = '203.0.113.50';
    const freshIp = '203.0.113.51';

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      await POST(request(`caller-${i}@parity.local`, exhaustedIp));
    }
    expect((await POST(request('blocked@parity.local', exhaustedIp))).status).toBe(429);

    expect((await POST(request('fine@parity.local', freshIp))).status).toBe(200);
  });
});
