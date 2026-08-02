import { route, readJson } from '@/lib/api/handler';
import { compareRequestSchema } from '@/lib/validation/compare';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import { CompareChannelsUseCase } from '@/application/usecases/CompareChannelsUseCase';
import type { CreditBucketRepository } from '@/application/ports/CreditBucketRepository';

/**
 * `POST /api/compare` — §5.2.
 *
 * "Stateless compute. Body `{ context, quotes }` → `{ results, ranked,
 * warnings, brg }`. **Does not persist.** Powers the live-editing UI."
 *
 * The budget in §5.3 is p95 < 100 ms because this runs on every keystroke
 * behind a 250 ms debounce. `route()` measures it and logs a warning when a
 * request exceeds it, so the number in the spec is observable rather than
 * aspirational.
 */

/** Stateless, so one instance is shared across requests — mirrors every other route. */
const engine = new SavingsEngine();

/**
 * The credit-bucket repository is constructed lazily, on first use rather
 * than at import, unlike the module-level singletons every other route
 * builds eagerly. Those routes get away with eager construction because
 * nothing imports their route module in a test; this route's contract test
 * (`route.test.ts`) *does* import `route.ts` directly, and `db.ts` throws if
 * `DATABASE_URL` is unset at module-evaluation time. A dynamic import here
 * defers that failure past "the module loaded" and into "a request without a
 * database actually ran" — which is also what keeps `/api/health` able to
 * import this route and report "degraded" instead of crashing at boot.
 */
let creditBucketsInstance: CreditBucketRepository | null = null;

async function creditBuckets(): Promise<CreditBucketRepository> {
  if (!creditBucketsInstance) {
    const { DrizzleCreditBucketRepository } = await import(
      '@/infrastructure/persistence/repositories/DrizzleCreditBucketRepository'
    );
    creditBucketsInstance = new DrizzleCreditBucketRepository();
  }
  return creditBucketsInstance;
}

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = compareRequestSchema.parse(await readJson(request));

    const useCase = new CompareChannelsUseCase(dependencies(logger), engine, await creditBuckets());
    return useCase.execute(payload, executionContext(session.userId, requestId));
  },
  { name: 'POST /api/compare', budgetMs: 100 },
);
