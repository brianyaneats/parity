import { ApiError } from '@/lib/api/errors';
import type { ComparisonRecord, ComparisonRepository } from '@/application/ports/ComparisonRepository';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface DeleteComparisonInput {
  readonly id: string;
  readonly userId: string;
}

/**
 * `DELETE /api/comparisons/:id` — §5.2: "soft delete."
 *
 * §4.2's schema has no `deleted_at` column on `comparisons`, so "soft" is
 * expressed with the lifecycle it already has: moving to `ABANDONED`, the one
 * `comparison_status` value that means "no longer live" without destroying
 * the row — which matters, because a booked comparison's snapshot is the
 * audit trail behind a real savings figure (§1.5) and must never be hard
 * deleted.
 */
export class DeleteComparisonUseCase extends CommandUseCase<DeleteComparisonInput, ComparisonRecord> {
  public readonly name = 'delete_comparison';

  constructor(deps: UseCaseDependencies, private readonly comparisons: ComparisonRepository) {
    super(deps);
  }

  protected async handle(input: DeleteComparisonInput, _ctx: ExecutionContext): Promise<ComparisonRecord> {
    const updated = await this.comparisons.update(input.id, input.userId, { status: 'ABANDONED' });
    if (!updated) throw ApiError.notFound('Comparison');
    return updated;
  }
}
