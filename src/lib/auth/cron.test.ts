import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { NextRequest } from 'next/server';
import { requireCronSecret, isDryRun } from './cron';
import { ApiError } from '@/lib/api/errors';

/**
 * `requireCronSecret`/`isDryRun` had zero direct test coverage before this —
 * every cron route's own test exercises them indirectly, but nothing pinned
 * the auth boundary itself: fail-closed on a missing `CRON_SECRET`, correct
 * bearer accepted, everything else rejected, and (the fix this file exists
 * for) a constant-time comparison rather than `!==` on the header — see
 * `session.test.ts`'s identical `constant-time comparison` block for why a
 * source-reading assertion, not a statistical timing test, is the documented
 * way to pin that property.
 */

function request(headers: Record<string, string> = {}, url = 'http://localhost:3000/api/cron/bucket-expiry-sweep'): NextRequest {
  return new Request(url, { headers }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireCronSecret — fail closed when unconfigured', () => {
  it('rejects every request, even one carrying what would otherwise be a valid-shaped header, when CRON_SECRET is unset', () => {
    vi.stubEnv('CRON_SECRET', '');

    expect(() => requireCronSecret(request({ authorization: 'Bearer test-cron-secret' }))).toThrow(ApiError);
    expect(() => requireCronSecret(request({ authorization: 'Bearer test-cron-secret' }))).toThrow(
      /CRON_SECRET is not configured/,
    );
  });
});

describe('requireCronSecret — bearer token check', () => {
  it('accepts the exact configured secret as a Bearer token', () => {
    expect(() => requireCronSecret(request({ authorization: 'Bearer test-cron-secret' }))).not.toThrow();
  });

  it('rejects a wrong token', () => {
    expect(() => requireCronSecret(request({ authorization: 'Bearer wrong-secret' }))).toThrow(ApiError);
  });

  it('rejects a missing Authorization header', () => {
    expect(() => requireCronSecret(request())).toThrow(ApiError);
  });

  it('rejects the right token with no "Bearer " prefix', () => {
    expect(() => requireCronSecret(request({ authorization: 'test-cron-secret' }))).toThrow(ApiError);
  });

  it('rejects the right token with the wrong scheme', () => {
    expect(() => requireCronSecret(request({ authorization: 'Basic test-cron-secret' }))).toThrow(ApiError);
  });

  it('rejects a header that is only a prefix or only a suffix of the expected value', () => {
    expect(() => requireCronSecret(request({ authorization: 'Bearer test-cron-secre' }))).toThrow(ApiError);
    expect(() => requireCronSecret(request({ authorization: 'Bearer test-cron-secretx' }))).toThrow(ApiError);
  });

  it('rejects an empty Authorization header without throwing on the comparison itself', () => {
    expect(() => requireCronSecret(request({ authorization: '' }))).not.toThrow(/timingSafeEqual/);
    expect(() => requireCronSecret(request({ authorization: '' }))).toThrow(ApiError);
  });
});

describe('requireCronSecret — constant-time comparison', () => {
  it('compares the bearer header via the shared constantTimeEqual helper, not !==', () => {
    // Same technique as session.test.ts: this is a property of the code, not
    // of any one input/output pair, so the documented alternative to a slow
    // and flaky statistical timing test is reading the implementation.
    const cronSource = readFileSync(new URL('./cron.ts', import.meta.url), 'utf8');
    expect(cronSource).toMatch(/import\s*{\s*constantTimeEqual\s*}\s*from\s*'\.\/constantTimeEqual'/);
    expect(cronSource).toMatch(/constantTimeEqual\(/);
    expect(cronSource).not.toMatch(/header\s*!==\s*expected|expected\s*!==\s*header/);

    const helperSource = readFileSync(new URL('./constantTimeEqual.ts', import.meta.url), 'utf8');
    expect(helperSource).toMatch(/import\s*{[^}]*\btimingSafeEqual\b[^}]*}\s*from\s*'node:crypto'/);
    expect(helperSource).toMatch(/timingSafeEqual\(/);
    expect(helperSource).toMatch(/\.length\s*!==\s*\w+\.length/);
  });
});

describe('isDryRun', () => {
  it('is true only for the literal query value "1"', () => {
    expect(isDryRun(request({}, 'http://localhost:3000/api/cron/bucket-expiry-sweep?dry=1'))).toBe(true);
  });

  it('is false with no dry param at all', () => {
    expect(isDryRun(request({}, 'http://localhost:3000/api/cron/bucket-expiry-sweep'))).toBe(false);
  });

  it('is false for "true", "0", or any value other than the literal string "1"', () => {
    expect(isDryRun(request({}, 'http://localhost:3000/api/cron/bucket-expiry-sweep?dry=true'))).toBe(false);
    expect(isDryRun(request({}, 'http://localhost:3000/api/cron/bucket-expiry-sweep?dry=0'))).toBe(false);
    expect(isDryRun(request({}, 'http://localhost:3000/api/cron/bucket-expiry-sweep?dry=yes'))).toBe(false);
  });

  it('does not require CRON_SECRET to be configured — dry-run parsing is not itself a gate', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(isDryRun(request({}, 'http://localhost:3000/api/cron/bucket-expiry-sweep?dry=1'))).toBe(true);
  });
});
