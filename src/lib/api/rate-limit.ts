import { ApiError } from './errors';

/**
 * Rate limiting — §5.1: "Rate limit mutations at 60/min/user via Upstash."
 *
 * Upstash is named, but no `@upstash/*` package is installed and no credentials
 * exist in this environment. Two ways to handle that: skip the requirement, or
 * build it behind a port so the guarantee exists today and the named backend
 * drops in when credentials do. This is the second.
 *
 * The in-process limiter is honest about what it is. On a single long-lived
 * server it is a real limit. On serverless, each instance keeps its own window,
 * so N warm instances allow up to N × the limit — which is a weaker guarantee
 * than Upstash's shared counter, and is why `RateLimiter` is an interface with
 * a documented `distributed` flag rather than a class everything imports
 * directly. See DECISIONS.md D-110.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch ms when the current window resets. */
  readonly resetAt: number;
}

export interface RateLimiter {
  /** Whether the counter is shared across instances. Reported in the log. */
  readonly distributed: boolean;
  check(key: string): Promise<RateLimitDecision>;
}

/** §5.1's figure: 60 mutations per minute per user. */
export const MUTATION_LIMIT_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

/**
 * A sliding-window counter in process memory.
 *
 * Sliding rather than fixed: a fixed window lets a caller send the full quota
 * in the last second of one window and again in the first second of the next,
 * which is 2× the stated limit at exactly the moment a limit matters.
 */
export class InMemoryRateLimiter implements RateLimiter {
  public readonly distributed = false;
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number = MUTATION_LIMIT_PER_MINUTE,
    private readonly windowMs: number = WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async check(key: string): Promise<RateLimitDecision> {
    const current = this.now();
    const cutoff = current - this.windowMs;

    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? current;
      this.hits.set(key, recent);
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt: oldest + this.windowMs,
      };
    }

    recent.push(current);
    this.hits.set(key, recent);

    // Opportunistic eviction: without it a long-lived process accumulates a
    // key per user forever.
    if (this.hits.size > 10_000) this.evict(cutoff);

    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - recent.length,
      resetAt: current + this.windowMs,
    };
  }

  private evict(cutoff: number): void {
    for (const [key, times] of this.hits) {
      const live = times.filter((at) => at > cutoff);
      if (live.length === 0) this.hits.delete(key);
      else this.hits.set(key, live);
    }
  }

  public reset(): void {
    this.hits.clear();
  }
}

/** Allows everything. For tests that are not about rate limiting. */
export const NULL_RATE_LIMITER: RateLimiter = Object.freeze({
  distributed: false,
  check: async () => ({
    allowed: true,
    limit: MUTATION_LIMIT_PER_MINUTE,
    remaining: MUTATION_LIMIT_PER_MINUTE,
    resetAt: 0,
  }),
});

/**
 * The process-wide limiter.
 *
 * When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured
 * and `@upstash/ratelimit` is installed, swap the construction here — nothing
 * else in the codebase needs to change, because callers depend on the
 * `RateLimiter` interface.
 */
export const rateLimiter: RateLimiter = new InMemoryRateLimiter();

function rateLimitedError(decision: RateLimitDecision): ApiError {
  const seconds = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
  return ApiError.rateLimited(
    `Too many changes in a short time. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
  );
}

/**
 * Throws `RATE_LIMITED` (429) when the caller is over budget.
 *
 * Applied to mutations only. Rate-limiting reads would break the comparator:
 * §5.3 has `POST /api/compare` called on every keystroke behind a 250 ms
 * debounce — that is nominally a POST, but it is a pure computation that
 * persists nothing, so it is exempted explicitly rather than by accident.
 */
export async function enforceRateLimit(
  limiter: RateLimiter,
  userId: string,
  route: string,
): Promise<RateLimitDecision> {
  const decision = await limiter.check(`${userId}:mutations`);
  if (!decision.allowed) throw rateLimitedError(decision);

  void route;
  return decision;
}

/**
 * Per-IP budget for *unauthenticated* mutations.
 *
 * §5.1's 60/min/user budget only applies once a session exists — deliberately,
 * per `route()`'s comment: a 401 should not be masked by a 429. But
 * `POST /api/auth/magic-link` is unauthenticated by nature (it is how sign-in
 * *starts*) and sends email to any address a caller supplies, so it is the one
 * mutating route with zero throttling — an email-bombing vector against a
 * stranger's inbox, and it burns Resend quota per attempt. This is a second,
 * separate budget keyed by client IP rather than userId, applied only when
 * there is no session (see `route()` in `./handler.ts`).
 *
 * Two windows, not one: a 5/minute cap alone would let a caller sit exactly
 * at the limit indefinitely (300/hour); a 20/hour cap alone would let a
 * caller spend the whole hourly budget in one burst. Both must pass.
 */
export const IP_MUTATION_LIMIT_PER_MINUTE = 5;
export const IP_MUTATION_LIMIT_PER_HOUR = 20;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface IpRateLimiters {
  readonly perMinute: RateLimiter;
  readonly perHour: RateLimiter;
}

/** The process-wide per-IP limiters. Same distributed caveat as `rateLimiter` above. */
export const ipRateLimiters: IpRateLimiters = {
  perMinute: new InMemoryRateLimiter(IP_MUTATION_LIMIT_PER_MINUTE, MINUTE_MS),
  perHour: new InMemoryRateLimiter(IP_MUTATION_LIMIT_PER_HOUR, HOUR_MS),
};

/**
 * Throws `RATE_LIMITED` (429) when an anonymous caller's IP is over either
 * window's budget. Checked minute-window first so an ordinary burst is
 * rejected without also spending a slot in the hour-window counter.
 */
export async function enforceIpRateLimit(
  limiters: IpRateLimiters,
  ip: string,
): Promise<RateLimitDecision> {
  const perMinute = await limiters.perMinute.check(`${ip}:ip-mutations:1m`);
  if (!perMinute.allowed) throw rateLimitedError(perMinute);

  const perHour = await limiters.perHour.check(`${ip}:ip-mutations:1h`);
  if (!perHour.allowed) throw rateLimitedError(perHour);

  return perMinute;
}

/** Used when no proxy in front of this app set `X-Forwarded-For` (e.g. a bare local request). */
export const UNKNOWN_CLIENT_IP = 'unknown';

/**
 * The client IP for `enforceIpRateLimit`, from the first hop of
 * `X-Forwarded-For` — the header Vercel's edge (and any standard reverse
 * proxy) sets in front of this app. Takes the raw header value rather than a
 * `NextRequest` so this module stays framework-agnostic, matching the rest
 * of this file.
 */
export function resolveClientIp(forwardedFor: string | null): string {
  if (!forwardedFor) return UNKNOWN_CLIENT_IP;
  const first = forwardedFor.split(',')[0]?.trim();
  return first || UNKNOWN_CLIENT_IP;
}

/** Methods that count against the mutation budget. */
export const MUTATING_METHODS: ReadonlySet<string> = Object.freeze(
  new Set(['POST', 'PATCH', 'PUT', 'DELETE']),
);

/**
 * Routes that use a mutating verb but do not mutate, and so are exempt.
 * Kept as an explicit list so an exemption is a decision, not an oversight.
 */
export const NON_MUTATING_POST_ROUTES: ReadonlySet<string> = Object.freeze(
  new Set(['/api/compare']),
);

export function countsAgainstBudget(method: string, pathname: string): boolean {
  if (!MUTATING_METHODS.has(method)) return false;
  return !NON_MUTATING_POST_ROUTES.has(pathname);
}
