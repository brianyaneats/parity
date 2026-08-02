import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { createComparisonSchema, comparisonListQuerySchema } from '@/lib/validation/comparisons';
import { parseQuery } from '@/lib/validation/shared';
import { CreateComparisonUseCase } from '@/application/usecases/CreateComparisonUseCase';
import { ListComparisonsUseCase } from '@/application/usecases/ListComparisonsUseCase';
import { DrizzleComparisonRepository } from '@/infrastructure/persistence/repositories/DrizzleComparisonRepository';

/** `POST`/`GET /api/comparisons` — §5.2. */
const comparisonRepository = new DrizzleComparisonRepository();

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = createComparisonSchema.parse(await readJson(request));

    const useCase = new CreateComparisonUseCase(dependencies(logger), comparisonRepository);
    return useCase.execute({ ...payload, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'POST /api/comparisons' },
);

export const GET = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const query = parseQuery(comparisonListQuerySchema, new URL(request.url).searchParams);

    const useCase = new ListComparisonsUseCase(dependencies(logger), comparisonRepository);
    return useCase.execute({ ...query, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/comparisons' },
);
