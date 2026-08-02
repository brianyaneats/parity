import { ApiError } from '@/lib/api/errors';
import type { ComparisonRecord, ComparisonRepository } from '@/application/ports/ComparisonRepository';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface GetComparisonInput {
  readonly id: string;
  readonly userId: string;
}

/** `GET /api/comparisons/:id` — §5.2. */
export class GetComparisonUseCase extends QueryUseCase<GetComparisonInput, ComparisonRecord> {
  public readonly name = 'get_comparison';

  constructor(deps: UseCaseDependencies, private readonly comparisons: ComparisonRepository) {
    super(deps);
  }

  protected async handle(input: GetComparisonInput, _ctx: ExecutionContext): Promise<ComparisonRecord> {
    const record = await this.comparisons.findById(input.id, input.userId);
    if (!record) throw ApiError.notFound('Comparison');
    return record;
  }
}
