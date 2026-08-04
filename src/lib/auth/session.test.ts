import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { encodeSession, decodeSession, SESSION_TTL_SECONDS, type Session } from './session';

/**
 * The session cookie used to be plain base64url JSON — anyone could mint
 * `{"userId": "<anyone>"}` and become that user, including against
 * `DELETE /api/account`. These tests pin the fix: the cookie is now
 * `payload.signature`, HMAC-SHA256 over the payload with `AUTH_SECRET`,
 * checked with a constant-time compare, and production refuses to issue or
 * accept a session at all when `AUTH_SECRET` is unset.
 */

const SESSION: Session = { userId: 'user-1', email: 'demo@parity.local' };

/** `noUncheckedIndexedAccess`-friendly split — asserts the shape tests rely on. */
function splitCookie(cookie: string): [payload: string, signature: string] {
  const [payload, signature] = cookie.split('.');
  if (!payload || !signature) {
    throw new Error(`expected a payload.signature cookie, got: ${cookie}`);
  }
  return [payload, signature];
}

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('encodeSession / decodeSession — signature round-trip', () => {
  it('decodes exactly what was encoded', () => {
    const cookie = encodeSession(SESSION);
    expect(decodeSession(cookie)).toEqual(SESSION);
  });

  it('produces a payload.signature shape carrying an exp claim', () => {
    const cookie = encodeSession(SESSION);
    expect(cookie.split('.')).toHaveLength(2);

    const [payload] = splitCookie(cookie);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    expect(claims).toEqual({ ...SESSION, exp: expect.any(Number) });
    // ~30 days out, in unix seconds — the enforced server-side expiry.
    const secondsFromNow = claims.exp - Math.floor(Date.now() / 1000);
    expect(secondsFromNow).toBeGreaterThan(SESSION_TTL_SECONDS - 60);
    expect(secondsFromNow).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });

  it('rejects an expired cookie even with a valid signature', () => {
    const secret = process.env.AUTH_SECRET ?? 'parity-dev-session-secret';
    const expired = { ...SESSION, exp: Math.floor(Date.now() / 1000) - 1 };
    const payload = Buffer.from(JSON.stringify(expired), 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    expect(decodeSession(`${payload}.${signature}`)).toBeNull();
  });

  it('rejects a signed cookie with no exp claim at all (the pre-expiry format)', () => {
    const secret = process.env.AUTH_SECRET ?? 'parity-dev-session-secret';
    const payload = Buffer.from(JSON.stringify(SESSION), 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    expect(decodeSession(`${payload}.${signature}`)).toBeNull();
  });

  it('rejects a cookie with no signature at all', () => {
    // The pre-fix format: bare base64url JSON, no `.signature` suffix.
    const bareLegacyCookie = Buffer.from(JSON.stringify(SESSION), 'utf8').toString('base64url');
    expect(decodeSession(bareLegacyCookie)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(decodeSession('not-a-real-cookie')).toBeNull();
    expect(decodeSession('')).toBeNull();
    expect(decodeSession('.')).toBeNull();
  });
});

describe('decodeSession — tamper detection', () => {
  it('rejects a payload edited after signing, even though the shape still looks valid', () => {
    const cookie = encodeSession(SESSION);
    const [, signature] = splitCookie(cookie);

    // An attacker swaps in a different userId, keeping the original
    // signature and a perfectly well-formed base64url-JSON payload.
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: 'someone-elses-account', email: 'demo@parity.local' }),
      'utf8',
    ).toString('base64url');

    expect(decodeSession(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it('rejects a signature that has been altered', () => {
    const cookie = encodeSession(SESSION);
    const [payload, signature] = splitCookie(cookie);
    const flipped = signature.charAt(0) === 'a' ? 'b' : 'a';
    const tamperedSignature = flipped + signature.slice(1);

    expect(decodeSession(`${payload}.${tamperedSignature}`)).toBeNull();
  });

  it('rejects a malformed payload even with a signature computed to match it', () => {
    // Not valid base64url JSON, but "signed" with the right secret over that
    // exact garbage string — the shape check on the decoded payload must
    // still reject it.
    const garbagePayload = 'not-valid-base64url-json';
    const signature = createHmac('sha256', 'test-auth-secret')
      .update(garbagePayload)
      .digest('base64url');

    expect(decodeSession(`${garbagePayload}.${signature}`)).toBeNull();
  });

  it('rejects a payload whose decoded JSON is missing userId', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'demo@parity.local' }), 'utf8').toString(
      'base64url',
    );
    const signature = createHmac('sha256', 'test-auth-secret').update(payload).digest('base64url');

    expect(decodeSession(`${payload}.${signature}`)).toBeNull();
  });
});

describe('decodeSession — wrong secret', () => {
  it('rejects a signature produced with a different secret', () => {
    const payload = Buffer.from(JSON.stringify(SESSION), 'utf8').toString('base64url');
    const signature = createHmac('sha256', 'a-completely-different-secret')
      .update(payload)
      .digest('base64url');

    expect(decodeSession(`${payload}.${signature}`)).toBeNull();
  });

  it('a cookie signed under one AUTH_SECRET fails to decode under another', () => {
    vi.stubEnv('AUTH_SECRET', 'secret-one');
    const cookie = encodeSession(SESSION);

    vi.stubEnv('AUTH_SECRET', 'secret-two');
    expect(decodeSession(cookie)).toBeNull();
  });
});

describe('constant-time comparison', () => {
  it('delegates signature comparison to the shared constantTimeEqual helper', () => {
    // A functional test can show a mismatch is rejected, but not that the
    // rejection path is constant-time — that's a property of the code, not
    // of any one input/output pair. Reading the implementation is the
    // documented alternative (§ task spec) to a statistical timing test,
    // which would be slow and flaky in CI.
    //
    // The comparison itself now lives in `constantTimeEqual.ts`, shared with
    // `cron.ts`'s bearer-token check (`cron.test.ts` pins that file's own
    // use of it) — this test just confirms `session.ts` calls the shared
    // helper rather than rolling its own comparison again.
    const sessionSource = readFileSync(new URL('./session.ts', import.meta.url), 'utf8');
    expect(sessionSource).toMatch(/import\s*{\s*constantTimeEqual\s*}\s*from\s*'\.\/constantTimeEqual'/);
    expect(sessionSource).toMatch(/constantTimeEqual\(/);
    // The module doc comment above is still allowed to *mention*
    // `timingSafeEqual` in prose (it explains the mechanism the shared
    // helper implements) — what must not exist is session.ts importing or
    // calling it directly, now that the comparison itself lives in
    // `constantTimeEqual.ts`.
    expect(sessionSource).not.toMatch(/import\s*{[^}]*\btimingSafeEqual\b[^}]*}\s*from\s*'node:crypto'/);
    expect(sessionSource).not.toMatch(/timingSafeEqual\(/);

    const helperSource = readFileSync(new URL('./constantTimeEqual.ts', import.meta.url), 'utf8');
    expect(helperSource).toMatch(/import\s*{[^}]*\btimingSafeEqual\b[^}]*}\s*from\s*'node:crypto'/);
    expect(helperSource).toMatch(/timingSafeEqual\(/);
    // The length check must happen before calling timingSafeEqual (which
    // throws on mismatched lengths) rather than being skipped.
    expect(helperSource).toMatch(/\.length\s*!==\s*\w+\.length/);
  });

  it('still rejects mismatched-length signatures without throwing', () => {
    const cookie = encodeSession(SESSION);
    const [payload] = splitCookie(cookie);
    expect(() => decodeSession(`${payload}.short`)).not.toThrow();
    expect(decodeSession(`${payload}.short`)).toBeNull();
  });
});

describe('AUTH_SECRET missing — fail closed in production, dev fallback otherwise', () => {
  it('production refuses to issue a session', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', '');

    expect(() => encodeSession(SESSION)).toThrow();
  });

  it('production refuses to accept any session, even a validly-shaped one', () => {
    // Signed under the dev fallback secret (as if a non-production process
    // minted it) — production must still refuse it rather than happening to
    // accept the well-known dev secret.
    const payload = Buffer.from(JSON.stringify(SESSION), 'utf8').toString('base64url');
    const signature = createHmac('sha256', 'parity-dev-session-secret')
      .update(payload)
      .digest('base64url');

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', '');

    expect(decodeSession(`${payload}.${signature}`)).toBeNull();
  });

  it('falls back to a fixed dev secret outside production so a clean clone still runs', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_SECRET', '');

    const cookie = encodeSession(SESSION);
    expect(decodeSession(cookie)).toEqual(SESSION);
  });

  it('a real AUTH_SECRET in production works normally — production only fails closed when unset', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a-real-production-secret');

    const cookie = encodeSession(SESSION);
    expect(decodeSession(cookie)).toEqual(SESSION);
  });
});
