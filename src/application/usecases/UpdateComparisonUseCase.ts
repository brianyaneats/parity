import { ApiError } from '@/lib/api/errors';
import type { ComparisonPatchInput } from '@/lib/validation/comparisons';
import type { ComparisonRecord, ComparisonRepository } from '@/application/ports/ComparisonRepository';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface UpdateComparisonInput extends ComparisonPatchInput {
  readonly id: string;
  readonly userId: string;
}

/**
 * `PATCH /api/comparisons/:id` — §5.2: "update status or chosen channel."
 *
 * Takes a `ComparisonPatch`, whose type has no `contextSnapshot`/
 * `resultSnapshot` fields at all (see `ComparisonRepository.ts`) — there is no
 * value of `input` that could reach the snapshot columns through this path.
 */
export class UpdateComparisonUseCase extends CommandUseCase<UpdateComparisonInput, ComparisonRecord> {
  public readonly name = 'update_comparison';

  constructor(deps: UseCaseDependencies, private readonly comparisons: ComparisonRepository) {
    super(deps);
  }

  protected async handle(input: UpdateComparisonInput, _ctx: ExecutionContext): Promise<ComparisonRecord> {
    const updated = await this.comparisons.update(input.id, input.userId, {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.chosenChannel !== undefined ? { chosenChannel: input.chosenChannel } : {}),
      ...(input.tripId !== undefined ? { tripId: input.tripId } : {}),
    });
    if (!updated) throw ApiError.notFound('Comparison');
    return updated;
  }
}
