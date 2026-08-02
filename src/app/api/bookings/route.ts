import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { createBookingSchema } from '@/lib/validation/bookings';
import { RecordBookingUseCase } from '@/application/usecases/RecordBookingUseCase';
import { DrizzleUnitOfWork } from '@/infrastructure/persistence/repositories/DrizzleUnitOfWork';
import { DrizzleComparisonRepository } from '@/infrastructure/persistence/repositories/DrizzleComparisonRepository';

/**
 * `POST /api/bookings` — §5.2 load-bearing behaviour #1. See
 * `RecordBookingUseCase` for the auto-claim side effect this route's success
 * response may carry (`claim: ClaimRecord | null`).
 */
const unitOfWork = new DrizzleUnitOfWork();
const comparisonRepository = new DrizzleComparisonRepository();

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = createBookingSchema.parse(await readJson(request));

    const useCase = new RecordBookingUseCase(dependencies(logger), unitOfWork, comparisonRepository);
    return useCase.execute({ ...payload, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'POST /api/bookings' },
);
