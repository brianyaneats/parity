import { NextResponse } from 'next/server';
import { metrics } from '@/infrastructure/observability/MetricsRegistry';
import { getSession } from '@/lib/auth/session';

/**
 * `GET /api/metrics`.
 *
 * Not in §5.2's route table — this exists to serve the owner's requirement for
 * performance metrics on every task, and it is the pull endpoint for the
 * in-process registry (DECISIONS.md D-042). §12 rules out a third-party
 * telemetry vendor, so metrics never leave the deployment; this is how they are
 * read.
 *
 * Authenticated by default. `METRICS_PUBLIC=true` opens it for a local
 * Prometheus scrape and is refused in production, because the counters reveal
 * usage patterns and, through the `channel` label, something about what the
 * user books.
 *
 * `Accept: text/plain` returns Prometheus exposition; anything else returns JSON.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const isPublic =
    process.env.METRICS_PUBLIC === 'true' && process.env.NODE_ENV !== 'production';

  if (!isPublic) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
        { status: 401 },
      );
    }
  }

  const wantsPrometheus = (request.headers.get('accept') ?? '').includes('text/plain');

  if (wantsPrometheus) {
    return new NextResponse(metrics.toPrometheus(), {
      status: 200,
      headers: {
        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
        'cache-control': 'no-store',
      },
    }) as unknown as NextResponse;
  }

  return NextResponse.json(metrics.snapshot(), {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
