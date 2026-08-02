import { SystemClock } from '@/domain/shared/Clock';
import { createLogger, type Logger } from '@/infrastructure/observability/Logger';
import { metrics } from '@/infrastructure/observability/MetricsRegistry';
import type { ExecutionContext, UseCaseDependencies } from './shared/UseCase';

/**
 * Per-request wiring shared by every route: the process-wide clock and the
 * two helpers that build a use case's dependencies and its execution
 * context.
 *
 * This is deliberately *not* a composition root — it constructs no
 * repositories and no use cases. Each route builds those itself,
 * module-level, the same way every route in `src/app/api` does (see
 * `src/app/api/bookings/route.ts` and `src/app/api/claims/[id]/route.ts`).
 * That split matters mechanically: this module imports nothing from
 * infrastructure persistence, so importing it — and therefore importing any
 * route — never requires `DATABASE_URL` to be set.
 */

const clock = new SystemClock();

export function dependencies(logger: Logger = createLogger()): UseCaseDependencies {
  return { logger, metrics, clock };
}

export function executionContext(
  userId: string,
  requestId: string,
): ExecutionContext {
  // Read the clock once per task so every step of one action agrees on "now".
  // Two steps disagreeing by a millisecond is exactly how a 24-hour deadline
  // ends up off by one second (§13.3).
  return { userId, requestId, now: clock.now() };
}
