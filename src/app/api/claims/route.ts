import { route } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { claimListQuerySchema } from '@/lib/validation/claims';
import { parseQuery } from '@/lib/validation/shared';
import { ListClaimsUseCase } from '@/application/usecases/ListClaimsUseCase';
import { DrizzleClaimRepository } from '@/infrastructure/persistence/repositories/DrizzleClaimRepository';

/** `GET /api/claims` — §5.2. `?status=&dueWithin=24h`. */
const claimRepository = new DrizzleClaimRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const query = parseQuery(claimListQuerySchema, new URL(request.url).searchParams);

    const useCase = new ListClaimsUseCase(dependencies(logger), claimRepository);
    return useCase.execute({ ...query, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/claims' },
);
