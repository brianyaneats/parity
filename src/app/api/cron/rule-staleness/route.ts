import { route } from '@/lib/api/handler';
import { requireCronSecret, isDryRun } from '@/lib/auth/cron';
import { dependencies, executionContext } from '@/application/runtime';
import { createNotifier } from '@/infrastructure/notifications/createNotifier';
import { DrizzleUserSettingsRepository } from '@/infrastructure/persistence/repositories/DrizzleUserSettingsRepository';
import { RuleStalenessDigestUseCase } from '@/application/usecases/cron/RuleStalenessDigestUseCase';

/** `rule-staleness` — weekly, Monday 09:00 (§9, `vercel.json`). */
export const dynamic = 'force-dynamic';

const userSettingsRepository = new DrizzleUserSettingsRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    requireCronSecret(request);
    const dryRun = isDryRun(request);
    const notifier = createNotifier(logger, { dryRun });

    const useCase = new RuleStalenessDigestUseCase(dependencies(logger), userSettingsRepository, notifier);
    return useCase.execute({ dryRun }, executionContext('cron:rule-staleness', requestId));
  },
  { name: 'GET /api/cron/rule-staleness' },
);
