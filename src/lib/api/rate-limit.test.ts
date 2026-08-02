import { describe, it, expect } from 'vitest';
import {
  InMemoryRateLimiter,
  NULL_RATE_LIMITER,
  enforceRateLimit,
  enforceIpRateLimit,
  resolveClientIp,
  countsAgainstBudget,
  MUTATION_LIMIT_PER_MINUTE,
  IP_MUTATION_LIMIT_PER_MINUTE,
  IP_MUTATION_LIMIT_PER_HOUR,
  UNKNOWN_CLIENT_IP,
  type IpRateLimiters,
} from './rate-limit';
import { ApiError, envelopeFor } from './errors';

/**
 * §5.1: "Rate limit mutations at 60/min/user via Upstash."
 *
 * Upstash itself is not installed here, so the guarantee lives behind the
 * `RateLimiter` interface with an in-process implementation. These tests pin
 * the *behaviour* — the limit, the window, the per-user isolation, the
 * exemption list — so swapping the backend cannot silently change what the
 * limit means. See DECISIONS.md D-110.
 */

describe('InMemoryRateLimiter', () => {
  it('allows exactly the configured number of calls in a window', () => {
    const limiter = new InMemoryRateLimiter(3, 60_000, () => 1_000);

    return (async () => {
      expect((await limiter.check('user-1')).allowed).toBe(true);
      expect((await limiter.check('user-1')).allowed).toBe(true);
      const third = await limiter.check('user-1');
      expect(third.allowed).toBe(true);
      expect(third.remaining).toBe(0);
      expect((await limiter.check('user-1')).allowed).toBe(false);
    })();
  });

  it('defaults to §5.1’s 60 per minute', async () => {
    let clock = 0;
    const limiter = new InMemoryRateLimiter(undefined, undefined, () => (clock += 1));

    for (let i = 0; i < MUTATION_LIMIT_PER_MINUTE; i += 1) {
      expect((await limiter.check('user-1')).allowed).toBe(true);
    }
    expect((await limiter.check('user-1')).allowed).toBe(false);
  });

  it('counts each user separately', async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000, () => 1_000);

    expect((await limiter.check('user-1')).allowed).toBe(true);
    expect((await limiter.check('user-1')).allowed).toBe(false);
    // One user exhausting their budget must not block anybody else.
    expect((await limiter.check('user-2')).allowed).toBe(true);
  });

  it('slides rather than resetting on a fixed boundary', async () => {
    // A fixed window would let a caller send the full quota in the last second
    // of one window and again in the first second of the next — 2× the stated
    // limit at exactly the moment the limit matters.
    let now = 0;
    const limiter = new InMemoryRateLimiter(2, 1_000, () => now);

    await limiter.check('user-1');
    now = 900;
    await limiter.check('user-1');
    now = 950;
    expect((await limiter.check('user-1')).allowed).toBe(false);

    // The first hit ages out at 1000ms, freeing exactly one slot.
    now = 1_001;
    expect((await limiter.check('user-1')).allowed).toBe(true);
    expect((await limiter.check('user-1')).allowed).toBe(false);
  });

  it('reports when the window resets so the caller can say how long to wait', async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000, () => 5_000);
    await limiter.check('user-1');

    const blocked = await limiter.check('user-1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBe(65_000);
  });

  it('clears on reset', async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000, () => 1_000);
    await limiter.check('user-1');
    limiter.reset();
    expect((await limiter.check('user-1')).allowed).toBe(true);
  });

  it('declares itself non-distributed, because it is', async () => {
    // On serverless each instance keeps its own window, so N warm instances
    // allow up to N × the limit. Saying so is better than implying otherwise.
    expect(new InMemoryRateLimiter().distributed).toBe(false);
  });
});

describe('enforceRateLimit', () => {
  it('passes through while under budget', async () => {
    const limiter = new InMemoryRateLimiter(5, 60_000, () => 1_000);
    await expect(enforceRateLimit(limiter, 'user-1', 'POST /api/bookings')).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('throws a 429 with a wait time the user can act on', async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    await enforceRateLimit(limiter, 'user-1', 'POST /api/bookings');

    await expect(enforceRateLimit(limiter, 'user-1', 'POST /api/bookings')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === 'RATE_LIMITED' &&
        error.status === 429 &&
        /Try again in \d+ seconds?\./.test(error.message),
    );
  });

  it('never blocks with the null limiter', async () => {
    for (let i = 0; i < 100; i += 1) {
      await expect(
        enforceRateLimit(NULL_RATE_LIMITER, 'user-1', 'POST /api/bookings'),
      ).resolves.toMatchObject({ allowed: true });
    }
  });
});

describe('resolveClientIp', () => {
  it('takes the first hop of X-Forwarded-For', () => {
    expect(resolveClientIp('203.0.113.5, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.5');
  });

  it('trims whitespace around the first hop', () => {
    expect(resolveClientIp(' 203.0.113.5 , 70.41.3.18')).toBe('203.0.113.5');
  });

  it('falls back when the header is absent or empty', () => {
    expect(resolveClientIp(null)).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp('')).toBe(UNKNOWN_CLIENT_IP);
  });
});

/**
 * §5.1's mutation budget only applies once a session exists — deliberately,
 * so an unauthenticated caller still gets an honest 401 instead of a 429
 * (see `route()` in `./handler.ts`). But `POST /api/auth/magic-link` is
 * unauthenticated by nature and sends email to any address supplied, so it
 * needed a budget of its own: this one, keyed by IP instead of userId.
 */
describe('enforceIpRateLimit — the unauthenticated-mutation budget', () => {
  function freshLimiters(now: () => number = () => 1_000): IpRateLimiters {
    return {
      perMinute: new InMemoryRateLimiter(IP_MUTATION_LIMIT_PER_MINUTE, 60_000, now),
      perHour: new InMemoryRateLimiter(IP_MUTATION_LIMIT_PER_HOUR, 60 * 60_000, now),
    };
  }

  it('allows exactly the configured per-minute figure, then blocks', async () => {
    const limiters = freshLimiters();

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      await expect(enforceIpRateLimit(limiters, '203.0.113.1')).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(enforceIpRateLimit(limiters, '203.0.113.1')).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'RATE_LIMITED' && error.status === 429,
    );
  });

  it('isolates budgets by IP — one caller maxing out does not affect another', async () => {
    const limiters = freshLimiters();

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      await enforceIpRateLimit(limiters, '203.0.113.1');
    }
    await expect(enforceIpRateLimit(limiters, '203.0.113.1')).rejects.toBeInstanceOf(ApiError);

    // A different IP has its own, untouched budget.
    await expect(enforceIpRateLimit(limiters, '198.51.100.9')).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('is a genuinely separate budget from the per-user one — exhausting it does not touch enforceRateLimit', async () => {
    const ipLimiters = freshLimiters();
    const userLimiter = new InMemoryRateLimiter(MUTATION_LIMIT_PER_MINUTE, 60_000, () => 1_000);

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      await enforceIpRateLimit(ipLimiters, '203.0.113.1');
    }
    await expect(enforceIpRateLimit(ipLimiters, '203.0.113.1')).rejects.toBeInstanceOf(ApiError);

    // The per-user limiter — a wholly different instance, keyed differently —
    // still has its full budget, exactly as before this feature existed.
    for (let i = 0; i < MUTATION_LIMIT_PER_MINUTE; i += 1) {
      await expect(enforceRateLimit(userLimiter, 'user-1', 'POST /api/bookings')).resolves.toMatchObject(
        { allowed: true },
      );
    }
    await expect(enforceRateLimit(userLimiter, 'user-1', 'POST /api/bookings')).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('also enforces the coarser hourly window once the per-minute window keeps sliding open', async () => {
    // A caller who never exceeds the per-minute cap, but sends steadily
    // enough to blow through the hourly one, must still be blocked — that is
    // the entire reason for the second window.
    let now = 0;
    const limiters: IpRateLimiters = {
      perMinute: new InMemoryRateLimiter(1_000, 60_000, () => now),
      perHour: new InMemoryRateLimiter(IP_MUTATION_LIMIT_PER_HOUR, 60 * 60_000, () => now),
    };

    for (let i = 0; i < IP_MUTATION_LIMIT_PER_HOUR; i += 1) {
      now += 60_000; // one full minute apart — never trips the per-minute window
      await expect(enforceIpRateLimit(limiters, '203.0.113.1')).resolves.toMatchObject({
        allowed: true,
      });
    }

    now += 60_000;
    await expect(enforceIpRateLimit(limiters, '203.0.113.1')).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'RATE_LIMITED' && error.status === 429,
    );
  });

  it('throwing over-budget produces the §5.1 error envelope', async () => {
    const limiters = freshLimiters();
    for (let i = 0; i < IP_MUTATION_LIMIT_PER_MINUTE; i += 1) {
      await enforceIpRateLimit(limiters, '203.0.113.1');
    }

    const error = await enforceIpRateLimit(limiters, '203.0.113.1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);

    const { status, body } = envelopeFor(error, 'req-123');
    expect(status).toBe(429);
    expect(body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: expect.stringContaining('Too many') as unknown as string,
        requestId: 'req-123',
      },
    });
  });
});

describe('countsAgainstBudget — which routes are limited', () => {
  it('limits the mutating verbs', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(countsAgainstBudget(method, '/api/bookings')).toBe(true);
    }
  });

  it('never limits reads', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(countsAgainstBudget(method, '/api/claims')).toBe(false);
    }
  });

  it('exempts POST /api/compare, which is a computation and not a mutation', () => {
    // §5.3: called on every keystroke behind a 250 ms debounce. A 60/min budget
    // would throttle ordinary typing. The exemption is an explicit list entry
    // rather than an accident of matching on the word "compare".
    expect(countsAgainstBudget('POST', '/api/compare')).toBe(false);
    expect(countsAgainstBudget('POST', '/api/comparisons')).toBe(true);
  });

  it('limits the irreversible routes', () => {
    expect(countsAgainstBudget('DELETE', '/api/account')).toBe(true);
    expect(countsAgainstBudget('POST', '/api/claims/abc/evidence')).toBe(true);
  });
});
