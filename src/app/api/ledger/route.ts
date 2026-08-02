import { route } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { ledgerQuerySchema } from '@/lib/validation/ledger';
import { parseQuery } from '@/lib/validation/shared';
import { GetLedgerUseCase } from '@/application/usecases/GetLedgerUseCase';
import { DrizzleSavingsEventRepository } from '@/infrastructure/persistence/repositories/DrizzleSavingsEventRepository';

const savingsEventRepository = new DrizzleSavingsEventRepository();

/**
 * `GET /api/ledger` — §5.2.
 *
 * Query params `from?`, `to?` (`YYYY-MM-DD`) and `realized?` (`"true"`/
 * `"false"`) filter the savings ledger; the response carries both the
 * matching events and the aggregate totals in one round trip.
 */
export const GET = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const query = parseQuery(ledgerQuerySchema, new URL(request.url).searchParams);

    const useCase = new GetLedgerUseCase(dependencies(logger), savingsEventRepository);
    return useCase.execute(
      { userId: session.userId, ...query },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'GET /api/ledger' },
);
