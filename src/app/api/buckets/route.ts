import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { consumeBucketSchema } from '@/lib/validation/buckets';
import { dependencies, executionContext } from '@/application/runtime';
import { DrizzleCreditBucketRepository } from '@/infrastructure/persistence/repositories/DrizzleCreditBucketRepository';
import { DrizzleSavingsEventRepository } from '@/infrastructure/persistence/repositories/DrizzleSavingsEventRepository';
import { ListBucketsUseCase } from '@/application/usecases/ListBucketsUseCase';
import { ConsumeBucketUseCase } from '@/application/usecases/ConsumeBucketUseCase';

/** `GET/POST /api/buckets` — §5.2, §7.5, §2.4. */
const creditBucketRepository = new DrizzleCreditBucketRepository();
const savingsEventRepository = new DrizzleSavingsEventRepository();

export const GET = route(
  async ({ logger, requestId }) => {
    const session = await requireUser();
    const useCase = new ListBucketsUseCase(dependencies(logger), creditBucketRepository);
    return useCase.execute({ userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/buckets' },
);

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = consumeBucketSchema.parse(await readJson(request));

    const useCase = new ConsumeBucketUseCase(dependencies(logger), creditBucketRepository, savingsEventRepository);
    return useCase.execute(
      { ...payload, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'POST /api/buckets' },
);
