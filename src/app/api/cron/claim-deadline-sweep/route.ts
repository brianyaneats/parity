import { route } from '@/lib/api/handler';
import { requireCronSecret, isDryRun } from '@/lib/auth/cron';
import { dependencies, executionContext } from '@/application/runtime';
import { createNotifier } from '@/infrastructure/notifications/createNotifier';
import { DrizzleClaimRepository } from '@/infrastructure/persistence/repositories/DrizzleClaimRepository';
import { ClaimDeadlineSweepUseCase } from '@/application/usecases/cron/ClaimDeadlineSweepUseCase';

/**
 * `claim-deadline-sweep` — every 15 minutes (§9, `vercel.json`).
 *
 * Vercel Cron issues a `GET` with `Authorization: Bearer $CRON_SECRET`.
 * `?dry=1` logs what would be sent/expired without sending or persisting a
 * notification — see `ClaimDeadlineSweepUseCase` for what "without side
 * effects" means precisely for the expiry half of this job (it still
 * transitions past-deadline claims either way; only the *notification* path
 * is what a real vs. dry run differs on, since expiry itself is not a thing
 * a dry run should pretend not to have happened — it is a correctness
 * transition, not a notification).
 */
export const dynamic = 'force-dynamic';

const claimRepository = new DrizzleClaimRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    requireCronSecret(request);
    const dryRun = isDryRun(request);
    const notifier = createNotifier(logger, { dryRun });

    const useCase = new ClaimDeadlineSweepUseCase(dependencies(logger), claimRepository, notifier);
    return useCase.execute({ dryRun }, executionContext('cron:claim-deadline-sweep', requestId));
  },
  { name: 'GET /api/cron/claim-deadline-sweep' },
);
