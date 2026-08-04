import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { pathParam } from '@/lib/api/params';
import { dependencies, executionContext } from '@/application/runtime';
import { claimEvidenceSchema } from '@/lib/validation/claims';
import { RecordClaimEvidenceUseCase } from '@/application/usecases/RecordClaimEvidenceUseCase';
import { DrizzleClaimRepository } from '@/infrastructure/persistence/repositories/DrizzleClaimRepository';
import { DrizzleBookingRepository } from '@/infrastructure/persistence/repositories/DrizzleBookingRepository';
import { DrizzleCompetingRateRepository } from '@/infrastructure/persistence/repositories/DrizzleCompetingRateRepository';
import { PostgresSignedUrlStorage } from '@/infrastructure/storage/PostgresSignedUrlStorage';

/** `POST /api/claims/:id/evidence` — §5.2, §12. */
const claimRepository = new DrizzleClaimRepository();
const bookingRepository = new DrizzleBookingRepository();
const competingRateRepository = new DrizzleCompetingRateRepository();
const objectStorage = new PostgresSignedUrlStorage();

export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const id = pathParam(request, 'claims');
    const payload = claimEvidenceSchema.parse(await readJson(request));

    const useCase = new RecordClaimEvidenceUseCase(
      dependencies(logger),
      claimRepository,
      bookingRepository,
      competingRateRepository,
      objectStorage,
    );
    return useCase.execute(
      { ...payload, id, userId: session.userId },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'POST /api/claims/:id/evidence' },
);
