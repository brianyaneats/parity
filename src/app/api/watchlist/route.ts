import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { parseQuery } from '@/lib/validation/shared';
import { createWatchlistSchema, deleteWatchlistQuerySchema } from '@/lib/validation/watchlist';
import { dependencies, executionContext } from '@/application/runtime';
import { DrizzleWatchlistRepository } from '@/infrastructure/persistence/repositories/DrizzleWatchlistRepository';
import { ListWatchlistUseCase } from '@/application/usecases/ListWatchlistUseCase';
import { CreateWatchlistUseCase } from '@/application/usecases/CreateWatchlistUseCase';
import { DeleteWatchlistUseCase } from '@/application/usecases/DeleteWatchlistUseCase';

/** `GET/POST/DELETE /api/watchlist` — §5.2, §7.6. */
const watchlistRepository = new DrizzleWatchlistRepository();

export const GET = route(
  async ({ logger, requestId }) => {
    const session = await requireUser();
    const useCase = new ListWatchlistUseCase(dependencies(logger), watchlistRepository);
    return useCase.execute({ userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/watchlist' },
);

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = createWatchlistSchema.parse(await readJson(request));

    const useCase = new CreateWatchlistUseCase(dependencies(logger), watchlistRepository);
    return useCase.execute(
      { ...payload, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'POST /api/watchlist' },
);

export const DELETE = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const query = parseQuery(deleteWatchlistQuerySchema, new URL(request.url).searchParams);

    const useCase = new DeleteWatchlistUseCase(dependencies(logger), watchlistRepository);
    return useCase.execute(
      { id: query.id, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'DELETE /api/watchlist' },
);
