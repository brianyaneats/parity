import { Claim } from '@/domain/claim/Claim';
import { RESOLVED_WITH_AWARD } from '@/domain/claim/ClaimStatus';
import { cents } from '@/domain/shared/cents';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import { ApiError } from '@/lib/api/errors';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { ClaimPatchInput } from '@/lib/validation/claims';
import type { ClaimRecord } from '@/application/ports/ClaimRepository';
import type { UnitOfWork } from '@/application/ports/UnitOfWork';
import { toClaimProps, toClaimPatch } from '../mappers/claim-mapper';
import { translateDomainError } from '../shared/domainErrors';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface TransitionClaimInput extends ClaimPatchInput {
  readonly id: string;
  readonly userId: string;
}

/**
 * `PATCH /api/claims/:id` — §5.2 load-bearing behaviour #2.
 *
 * "On APPROVED/PARTIAL require `awarded_cents` and write a `savings_events`
 * row with `realized = true`. Drive the transition through the `Claim`
 * aggregate so §7.4's rule … is enforced in one place."
 *
 * `Claim.transitionTo` is the *only* place that decides whether the move is
 * legal and whether an award is required (the Zod schema also checks the
 * award requirement — see `claims.ts` validation — but that is defence in
 * depth for a fast 422 before touching the aggregate at all; the aggregate is
 * still the authority, per §7.4). The status write and the savings-event
 * write happen inside one `UnitOfWork.run()` call: a realized saving with no
 * claim behind it (or the reverse) would break the ledger's auditability,
 * which §1.5 lists as a success criterion.
 */
export class TransitionClaimUseCase extends CommandUseCase<TransitionClaimInput, ClaimRecord> {
  public readonly name = 'transition_claim';

  constructor(deps: UseCaseDependencies, private readonly uow: UnitOfWork) {
    super(deps);
  }

  protected async handle(
    input: TransitionClaimInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<ClaimRecord> {
    return this.uow.run(async (repos) => {
      const existing = await repos.claims.findById(input.id, input.userId);
      if (!existing) throw ApiError.notFound('Claim');

      const claim = Claim.rehydrate(toClaimProps(existing));

      try {
        claim.transitionTo(input.status, ctx.now, {
          awardedCents: input.awardedCents !== undefined ? cents(input.awardedCents) : undefined,
          denialReason: input.denialReason,
          denialCode: input.denialCode,
          notes: input.notes,
        });
      } catch (error) {
        translateDomainError(error);
      }

      const updated = await repos.claims.update(input.id, input.userId, toClaimPatch(claim));
      if (!updated) throw ApiError.notFound('Claim');

      if (RESOLVED_WITH_AWARD.has(claim.status)) {
        const awarded = claim.realisedSavingCents();
        await repos.savingsEvents.create({
          userId: input.userId,
          bookingId: claim.bookingId,
          claimId: claim.id,
          kind: claim.kind.startsWith('BRG_') ? 'BRG' : 'PRICE_MATCH',
          amountCents: awarded,
          realized: true,
          occurredOn: toIsoDate(ctx.now),
          note: `Claim ${claim.kind} resolved ${claim.status}.`,
        });

        this.deps.metrics.increment('claim.resolved', { status: claim.status });
        logger.info('claim resolved with an award — realized savings event recorded', {
          claimId: claim.id,
          status: claim.status,
          awardedCents: awarded,
        });
      }

      return updated;
    });
  }

  protected override describeInput(input: TransitionClaimInput) {
    return { status: input.status, hasAward: input.awardedCents !== undefined };
  }
}
