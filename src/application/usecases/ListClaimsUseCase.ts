import type { ClaimListQuery } from '@/lib/validation/claims';
import type { ClaimRecord, ClaimRepository } from '@/application/ports/ClaimRepository';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface ListClaimsInput extends ClaimListQuery {
  readonly userId: string;
}

/** `GET /api/claims` — §5.2. `?status=&dueWithin=24h`. */
export class ListClaimsUseCase extends QueryUseCase<ListClaimsInput, readonly ClaimRecord[]> {
  public readonly name = 'list_claims';

  constructor(deps: UseCaseDependencies, private readonly claims: ClaimRepository) {
    super(deps);
  }

  protected async handle(
    input: ListClaimsInput,
    ctx: ExecutionContext,
  ): Promise<readonly ClaimRecord[]> {
    const hoursMatch = input.dueWithin?.match(/^(\d+)h$/);
    const dueWithinMs = hoursMatch?.[1] ? Number(hoursMatch[1]) * 60 * 60 * 1000 : undefined;

    return this.claims.list(input.userId, {
      ...(input.status ? { status: [input.status] } : {}),
      ...(dueWithinMs !== undefined ? { dueWithinMs } : {}),
      now: ctx.now,
    });
  }
}
