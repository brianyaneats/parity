import { Claim } from '@/domain/claim/Claim';
import { cents } from '@/domain/shared/cents';
import { ApiError } from '@/lib/api/errors';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { ClaimEvidenceInput } from '@/lib/validation/claims';
import type { BookingRepository } from '@/application/ports/BookingRepository';
import type { ClaimRepository } from '@/application/ports/ClaimRepository';
import type { CompetingRateRepository } from '@/application/ports/CompetingRateRepository';
import type { ObjectStorage } from '@/application/ports/ObjectStorage';
import { toClaimPatch, toClaimProps } from '../mappers/claim-mapper';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface RecordClaimEvidenceInput extends ClaimEvidenceInput {
  readonly id: string;
  readonly userId: string;
}

export interface RecordClaimEvidenceOutput {
  readonly uploadUrl: string;
  readonly screenshotKey: string;
  readonly expiresAt: string;
  readonly competingRateId: string;
}

/**
 * `POST /api/claims/:id/evidence` — §5.2.
 *
 * "Writes `screenshot_key` onto the claim's linked `competing_rates` row —
 * that is where the column lives — a claim with no `competing_rate_id` must
 * create one first." `competing_rates.comparison_id` is `NOT NULL` in §4.2's
 * schema, so creating one requires the claim's booking to have a linked
 * comparison; a booking recorded without one (`comparisonId: null`) cannot
 * gain a competing rate through this route, and that is reported as a 409
 * rather than silently doing nothing.
 */
export class RecordClaimEvidenceUseCase extends CommandUseCase<
  RecordClaimEvidenceInput,
  RecordClaimEvidenceOutput
> {
  public readonly name = 'record_claim_evidence';

  constructor(
    deps: UseCaseDependencies,
    private readonly claims: ClaimRepository,
    private readonly bookings: BookingRepository,
    private readonly competingRates: CompetingRateRepository,
    private readonly storage: ObjectStorage,
  ) {
    super(deps);
  }

  protected async handle(
    input: RecordClaimEvidenceInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<RecordClaimEvidenceOutput> {
    const existing = await this.claims.findById(input.id, input.userId);
    if (!existing) throw ApiError.notFound('Claim');

    let competingRateId = existing.competingRateId;

    if (!competingRateId) {
      if (!input.competingRate) {
        throw ApiError.validation(
          'This claim has no competing rate on file yet — include `competingRate` to create one.',
          { competingRate: 'is required the first time evidence is attached' },
        );
      }

      const booking = await this.bookings.findById(existing.bookingId, input.userId);
      if (!booking) throw ApiError.notFound('Booking');
      if (!booking.comparisonId) {
        throw ApiError.conflict(
          "This claim's booking has no linked comparison, so a competing rate record cannot be created for it.",
        );
      }

      const created = await this.competingRates.create(booking.comparisonId, {
        siteDomain: input.competingRate.siteDomain,
        url: input.competingRate.url,
        baseCents: cents(input.competingRate.baseCents),
        taxCents: input.competingRate.taxCents != null ? cents(input.competingRate.taxCents) : null,
        refundable: input.competingRate.refundable,
        publiclyAvailable: input.competingRate.publiclyAvailable,
        roomType: input.competingRate.roomType ?? null,
        bedType: input.competingRate.bedType ?? null,
        adults: input.competingRate.adults ?? null,
        children: input.competingRate.children ?? null,
        currency: input.competingRate.currency ?? null,
        capturedAt: ctx.now,
      });
      competingRateId = created.id;

      const claim = Claim.rehydrate(toClaimProps(existing));
      claim.attachCompetingRate(competingRateId, ctx.now);
      await this.claims.update(input.id, input.userId, toClaimPatch(claim));
    }

    const signed = await this.storage.createSignedUploadUrl({
      keyPrefix: `claims/${input.id}`,
      contentType: input.contentType,
    });
    await this.competingRates.setScreenshotKey(competingRateId, signed.key);

    logger.info('evidence upload URL issued', { claimId: input.id, competingRateId });

    return {
      uploadUrl: signed.uploadUrl,
      screenshotKey: signed.key,
      expiresAt: signed.expiresAt.toISOString(),
      competingRateId,
    };
  }
}
