import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@/domain/engine/version';
import { createLogger } from '@/infrastructure/observability/Logger';

/**
 * `GET /api/health` — §5.2.
 *
 * The one unauthenticated route (§5.1). Liveness plus a database ping, which
 * is the P0 gate in Part 11.
 *
 * Returns 503 rather than 200-with-a-flag when the database is unreachable, so
 * a platform health check fails the deployment instead of routing traffic to an
 * instance that cannot serve a single page.
 *
 * The database check's failure `error` field is a fixed, generic string
 * (`"database unreachable"`), never the driver's own `error.message` — this
 * is the one unauthenticated route in the app, so whatever it returns is
 * public by definition, and a raw Postgres driver error can carry internal
 * detail (hostname, username, connection diagnostics) that has no business
 * leaving the deployment. The full error still goes to the server-side log,
 * keyed by a request id, exactly like every `route()`-wrapped handler does —
 * this one just builds that logger by hand, the same way
 * `src/app/api/auth/callback/route.ts` does, since it predates `route()` and
 * cannot return JSON unconditionally the way that wrapper assumes.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const logger = createLogger().child({ requestId, route: '/api/health' });

  let database: { ok: boolean; latencyMs: number | null; error?: string } = {
    ok: false,
    latencyMs: null,
  };

  try {
    // Imported lazily so a missing DATABASE_URL surfaces here as an unhealthy
    // check rather than crashing the module graph at import time.
    const { checkDatabase } = await import('@/infrastructure/persistence/db');
    const latencyMs = await checkDatabase();
    database = { ok: true, latencyMs };
  } catch (error) {
    logger.error('health check: database unreachable', error);
    database = {
      ok: false,
      latencyMs: null,
      error: 'database unreachable',
    };
  }

  const body = {
    status: database.ok ? ('ok' as const) : ('degraded' as const),
    engineVersion: ENGINE_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database },
    tookMs: Math.round(performance.now() - startedAt),
  };

  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
