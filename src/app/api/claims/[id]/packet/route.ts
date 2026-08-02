import { route } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { pathParam } from '@/lib/api/params';
import { dependencies, executionContext } from '@/application/runtime';
import { GetClaimPacketUseCase } from '@/application/usecases/GetClaimPacketUseCase';
import { DrizzleClaimRepository } from '@/infrastructure/persistence/repositories/DrizzleClaimRepository';
import { DrizzleBookingRepository } from '@/infrastructure/persistence/repositories/DrizzleBookingRepository';
import { DrizzleCompetingRateRepository } from '@/infrastructure/persistence/repositories/DrizzleCompetingRateRepository';
import { DrizzleComparisonRepository } from '@/infrastructure/persistence/repositories/DrizzleComparisonRepository';
import { DrizzlePropertyRepository } from '@/infrastructure/persistence/repositories/DrizzlePropertyRepository';

/** `GET /api/claims/:id/packet` — §5.2, §7.4. */
const claimRepository = new DrizzleClaimRepository();
const bookingRepository = new DrizzleBookingRepository();
const competingRateRepository = new DrizzleCompetingRateRepository();
const comparisonRepository = new DrizzleComparisonRepository();
const propertyRepository = new DrizzlePropertyRepository();

export const GET = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'claims');

    const useCase = new GetClaimPacketUseCase(
      dependencies(logger),
      claimRepository,
      bookingRepository,
      competingRateRepository,
      comparisonRepository,
      propertyRepository,
    );
    return useCase.execute({ id, userId: session.userId }, executionContext(session.userId, requestId));
  },
  { name: 'GET /api/claims/:id/packet' },
);
