import { route } from '@/lib/api/handler';
import { requireCronSecret, isDryRun } from '@/lib/auth/cron';
import { dependencies, executionContext } from '@/application/runtime';
import { createNotifier } from '@/infrastructure/notifications/createNotifier';
import { DrizzleCreditBucketRepository } from '@/infrastructure/persistence/repositories/DrizzleCreditBucketRepository';
import { BucketExpirySweepUseCase } from '@/application/usecases/cron/BucketExpirySweepUseCase';

/** `bucket-expiry-sweep` — daily 09:00 (§9, `vercel.json`). */
export const dynamic = 'force-dynamic';

const creditBucketRepository = new DrizzleCreditBucketRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    requireCronSecret(request);
    const dryRun = isDryRun(request);
    const notifier = createNotifier(logger, { dryRun });

    const useCase = new BucketExpirySweepUseCase(dependencies(logger), creditBucketRepository, notifier);
    return useCase.execute({ dryRun }, executionContext('cron:bucket-expiry-sweep', requestId));
  },
  { name: 'GET /api/cron/bucket-expiry-sweep' },
);
