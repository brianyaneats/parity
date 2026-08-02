import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { pathParam } from '@/lib/api/params';
import { dependencies, executionContext } from '@/application/runtime';
import { claimPatchSchema } from '@/lib/validation/claims';
import { TransitionClaimUseCase } from '@/application/usecases/TransitionClaimUseCase';
import { DrizzleUnitOfWork } from '@/infrastructure/persistence/repositories/DrizzleUnitOfWork';

/**
 * `PATCH /api/claims/:id` — §5.2 load-bearing behaviour #2. See
 * `TransitionClaimUseCase` for the realized-savings-event side effect.
 */
const unitOfWork = new DrizzleUnitOfWork();

export const PATCH = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'claims');
    const payload = claimPatchSchema.parse(await readJson(request));

    const useCase = new TransitionClaimUseCase(dependencies(logger), unitOfWork);
    return useCase.execute(
      { ...payload, id, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'PATCH /api/claims/:id' },
);
