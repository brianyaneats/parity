import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { pathParam } from '@/lib/api/params';
import { dependencies, executionContext } from '@/application/runtime';
import { bookingPatchSchema } from '@/lib/validation/bookings';
import { GetBookingUseCase } from '@/application/usecases/GetBookingUseCase';
import { UpdateBookingUseCase } from '@/application/usecases/UpdateBookingUseCase';
import { DrizzleBookingRepository } from '@/infrastructure/persistence/repositories/DrizzleBookingRepository';
import { DrizzleWatchlistRepository } from '@/infrastructure/persistence/repositories/DrizzleWatchlistRepository';
import { DrizzleCreditBucketRepository } from '@/infrastructure/persistence/repositories/DrizzleCreditBucketRepository';

/** `GET`/`PATCH /api/bookings/:id` — §5.2. */
const bookingRepository = new DrizzleBookingRepository();
const watchlistRepository = new DrizzleWatchlistRepository();
const creditBucketRepository = new DrizzleCreditBucketRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'bookings');

    const useCase = new GetBookingUseCase(dependencies(logger), bookingRepository);
    return useCase.execute({ id, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/bookings/:id' },
);

export const PATCH = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'bookings');
    const payload = bookingPatchSchema.parse(await readJson(request));

    const useCase = new UpdateBookingUseCase(
      dependencies(logger),
      bookingRepository,
      watchlistRepository,
      creditBucketRepository,
    );
    return useCase.execute(
      { ...payload, id, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'PATCH /api/bookings/:id' },
);
