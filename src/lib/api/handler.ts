import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createLogger, type Logger } from '@/infrastructure/observability/Logger';
import { metrics } from '@/infrastructure/observability/MetricsRegistry';
import { envelopeFor, ApiError } from './errors';
import {
  countsAgainstBudget,
  enforceRateLimit,
  enforceIpRateLimit,
  rateLimiter,
  ipRateLimiters,
  resolveClientIp,
} from './rate-limit';
import { getSession } from '@/lib/auth/session';

/**
 * The route wrapper — §5.1.
 *
 * Every route gets, without opting in: a request id (generated or taken from an
 * upstream `X-Request-Id`), a logger scoped to that id, request-level latency
 * and outcome metrics, and the uniform error envelope. §5.1 requires the id
 * returned in `X-Request-Id`, and the error envelope carries it too so a user
 * reporting a problem can quote one string that finds the exact log line.
 *
 * Errors are never allowed to escape as a stack trace. `envelopeFor` decides
 * what the client sees; the full error, including the stack, goes to the log.
 */

export interface RouteContext {
  readonly requestId: string;
  readonly logger: Logger;
  readonly request: NextRequest;
}

export type RouteHandler<T> = (ctx: RouteContext) => Promise<T>;

export interface HandlerOptions {
  /** Metric label. Defaults to the pathname, which is fine for static routes. */
  readonly name?: string;
  /** §5.3 sets a p95 budget for `POST /api/compare`; exceeding it logs a warning. */
  readonly budgetMs?: number;
}

export function route<T>(handler: RouteHandler<T>, options: HandlerOptions = {}) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const requestId = request.headers.get('x-request-id') ?? randomUUID();
    const name = options.name ?? new URL(request.url).pathname;

    const logger = createLogger().child({
      requestId,
      route: name,
      method: request.method,
    });

    const labels = { route: name, method: request.method } as const;
    const started = performance.now();

    try {
      // §5.1: "Rate limit mutations at 60/min/user." Enforced here rather than
      // in each of the twenty-five route files, because a limit that has to be
      // remembered per route is a limit that will be missing from one of them.
      //
      // The session is read directly rather than through `requireUser()` so an
      // unauthenticated request still reaches the handler and fails with 401
      // — the honest error — instead of being masked by a 429.
      //
      // Without a session there is no userId to key a budget on, but an
      // unauthenticated mutation is not automatically harmless — most
      // visibly, `POST /api/auth/magic-link`, which sends email to any
      // address a caller supplies and has no other gate. That case gets a
      // separate, stricter budget keyed by client IP instead.
      if (countsAgainstBudget(request.method, new URL(request.url).pathname)) {
        const session = await getSession();
        if (session) {
          const decision = await enforceRateLimit(rateLimiter, session.userId, name);
          if (decision.remaining <= 5) {
            logger.warn('caller is close to the mutation rate limit', {
              remaining: decision.remaining,
              limit: decision.limit,
            });
          }
        } else {
          const ip = resolveClientIp(request.headers.get('x-forwarded-for'));
          const decision = await enforceIpRateLimit(ipRateLimiters, ip);
          if (decision.remaining <= 1) {
            logger.warn('anonymous caller is close to the per-IP mutation rate limit', {
              remaining: decision.remaining,
              limit: decision.limit,
            });
          }
        }
      }

      const body = await handler({ requestId, logger, request });
      const durationMs = performance.now() - started;

      metrics.observe('http.duration_ms', durationMs, labels);
      metrics.increment('http.requests', { ...labels, status: '200' });

      if (options.budgetMs !== undefined && durationMs > options.budgetMs) {
        logger.warn('route exceeded its latency budget', {
          durationMs: Math.round(durationMs),
          budgetMs: options.budgetMs,
        });
        metrics.increment('http.budget_exceeded', labels);
      }

      return NextResponse.json(body, {
        status: 200,
        headers: {
          'x-request-id': requestId,
          // Rates come from the user and results are per-user; nothing here is
          // shareable or cacheable (§12 treats the hotel list as sensitive).
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      const durationMs = performance.now() - started;
      const { status, body } = envelopeFor(error, requestId);

      metrics.observe('http.duration_ms', durationMs, labels);
      metrics.increment('http.requests', { ...labels, status: String(status) });

      // A 4xx is the client's problem and is expected traffic; a 5xx is ours.
      if (status >= 500) {
        logger.error('route failed', error, { durationMs: Math.round(durationMs), status });
      } else {
        logger.info('route rejected the request', {
          durationMs: Math.round(durationMs),
          status,
          code: body.error.code,
        });
      }

      return NextResponse.json(body, {
        status,
        headers: { 'x-request-id': requestId, 'cache-control': 'no-store' },
      });
    }
  };
}

/** Parses a JSON body, turning a malformed one into a 422 rather than a 500. */
export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw ApiError.validation('The request body was not valid JSON.');
  }
}
