import { NextResponse } from 'next/server';
import { ENGINE_VERSION } from '@/domain/engine/version';

/**
 * `GET /api/health` — §5.2.
 *
 * The one unauthenticated route (§5.1). Liveness plus a database ping, which
 * is the P0 gate in Part 11.
 *
 * Returns 503 rather than 200-with-a-flag when the database is unreachable, so
 * a platform health check fails the deployment instead of routing traffic to an
 * instance that cannot serve a single page.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const startedAt = performance.now();

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
    database = {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : 'unreachable',
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
