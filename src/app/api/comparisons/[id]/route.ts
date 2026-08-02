import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { pathParam } from '@/lib/api/params';
import { dependencies, executionContext } from '@/application/runtime';
import { comparisonPatchSchema } from '@/lib/validation/comparisons';
import { GetComparisonUseCase } from '@/application/usecases/GetComparisonUseCase';
import { UpdateComparisonUseCase } from '@/application/usecases/UpdateComparisonUseCase';
import { DeleteComparisonUseCase } from '@/application/usecases/DeleteComparisonUseCase';
import { DrizzleComparisonRepository } from '@/infrastructure/persistence/repositories/DrizzleComparisonRepository';

/** `GET`/`PATCH`/`DELETE /api/comparisons/:id` — §5.2. */
const comparisonRepository = new DrizzleComparisonRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'comparisons');

    const useCase = new GetComparisonUseCase(dependencies(logger), comparisonRepository);
    return useCase.execute({ id, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/comparisons/:id' },
);

export const PATCH = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'comparisons');
    const payload = comparisonPatchSchema.parse(await readJson(request));

    const useCase = new UpdateComparisonUseCase(dependencies(logger), comparisonRepository);
    return useCase.execute(
      { ...payload, id, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'PATCH /api/comparisons/:id' },
);

export const DELETE = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'comparisons');

    const useCase = new DeleteComparisonUseCase(dependencies(logger), comparisonRepository);
    return useCase.execute({ id, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'DELETE /api/comparisons/:id' },
);
