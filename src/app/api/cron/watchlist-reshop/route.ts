import { route } from '@/lib/api/handler';
import { requireCronSecret, isDryRun } from '@/lib/auth/cron';
import { dependencies, executionContext } from '@/application/runtime';
import { createNotifier } from '@/infrastructure/notifications/createNotifier';
import { DrizzleWatchlistRepository } from '@/infrastructure/persistence/repositories/DrizzleWatchlistRepository';
import { WatchlistReshopUseCase } from '@/application/usecases/cron/WatchlistReshopUseCase';

/** `watchlist-reshop` — daily 09:00 (§9, `vercel.json`). */
export const dynamic = 'force-dynamic';

const watchlistRepository = new DrizzleWatchlistRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    requireCronSecret(request);
    const dryRun = isDryRun(request);
    const notifier = createNotifier(logger, { dryRun });

    const useCase = new WatchlistReshopUseCase(dependencies(logger), watchlistRepository, notifier);
    return useCase.execute({ dryRun }, executionContext('cron:watchlist-reshop', requestId));
  },
  { name: 'GET /api/cron/watchlist-reshop' },
);
