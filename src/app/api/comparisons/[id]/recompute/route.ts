import { route } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { pathParam } from '@/lib/api/params';
import { dependencies, executionContext } from '@/application/runtime';
import { RecomputeComparisonUseCase } from '@/application/usecases/RecomputeComparisonUseCase';
import { DrizzleComparisonRepository } from '@/infrastructure/persistence/repositories/DrizzleComparisonRepository';

/**
 * `POST /api/comparisons/:id/recompute` — §5.2 load-bearing behaviour #3.
 * See `RecomputeComparisonUseCase` — this route has no body to validate at
 * all, because everything it needs already lives on the original row.
 */
const comparisonRepository = new DrizzleComparisonRepository();

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'comparisons');

    const useCase = new RecomputeComparisonUseCase(dependencies(logger), comparisonRepository);
    return useCase.execute({ id, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'POST /api/comparisons/:id/recompute' },
);
