import { route } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { ListRulesUseCase } from '@/application/usecases/ListRulesUseCase';

/**
 * `GET /api/rules` — §5.2, §2.8.
 *
 * No repository behind this one — every rule constant lives in
 * `@/domain/rules/registry` as code, not a table, so the use case is a thin
 * instrumented wrapper around `buildRuleViews`.
 */
export const GET = route(
  async ({ logger, requestId }) => {
    const session = await requireUser();

    const useCase = new ListRulesUseCase(dependencies(logger));
    return useCase.execute({ userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/rules' },
);
