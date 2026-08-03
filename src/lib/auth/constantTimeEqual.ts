import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison, shared by every secret-bearing comparison
 * in this app: the session cookie's HMAC signature (`session.ts`) and the
 * cron bearer token (`cron.ts`).
 *
 * A plain `===`/`!==` on two strings short-circuits at the first differing
 * byte, so how long the comparison takes leaks how many leading bytes an
 * attacker's guess got right — enough samples over enough requests turns
 * that into a byte-by-byte oracle for the secret. `crypto.timingSafeEqual`
 * closes that: it always inspects every byte of both buffers.
 *
 * `timingSafeEqual` itself *throws* on a length mismatch rather than
 * returning `false`, so the length check here must happen first — skipping
 * it would turn "wrong length" into an uncaught exception instead of "not
 * equal," which is the one case a caller most needs to hit the same code
 * path as any other mismatch.
 */
export function constantTimeEqual(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
