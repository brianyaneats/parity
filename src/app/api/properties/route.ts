import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { parseQuery } from '@/lib/validation/shared';
import { createPropertySchema, propertySearchQuerySchema } from '@/lib/validation/properties';
import { dependencies, executionContext } from '@/application/runtime';
import { DrizzlePropertyRepository } from '@/infrastructure/persistence/repositories/DrizzlePropertyRepository';
import { SearchPropertiesUseCase } from '@/application/usecases/SearchPropertiesUseCase';
import { CreatePropertyUseCase } from '@/application/usecases/CreatePropertyUseCase';

/**
 * `GET/POST /api/properties` — §5.2, §7.8.
 *
 * One repository instance per module, reused across requests — the same
 * per-route construction every route in `src/app/api` uses, `POST
 * /api/compare` included.
 */
const propertyRepository = new DrizzlePropertyRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const query = parseQuery(propertySearchQuerySchema, new URL(request.url).searchParams);

    const useCase = new SearchPropertiesUseCase(dependencies(logger), propertyRepository);
    return useCase.execute({ userId: session.userId, ...query }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/properties' },
);

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = createPropertySchema.parse(await readJson(request));

    const useCase = new CreatePropertyUseCase(dependencies(logger), propertyRepository);
    return useCase.execute(
      { ...payload, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'POST /api/properties' },
);
