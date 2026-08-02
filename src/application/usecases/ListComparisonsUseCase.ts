import type { ComparisonListQuery } from '@/lib/validation/comparisons';
import type {
  ComparisonListPage,
  ComparisonRepository,
} from '@/application/ports/ComparisonRepository';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface ListComparisonsInput extends ComparisonListQuery {
  readonly userId: string;
}

/** `GET /api/comparisons` — §5.2. `?tripId=&status=&cursor=`. */
export class ListComparisonsUseCase extends QueryUseCase<ListComparisonsInput, ComparisonListPage> {
  public readonly name = 'list_comparisons';

  constructor(deps: UseCaseDependencies, private readonly comparisons: ComparisonRepository) {
    super(deps);
  }

  protected async handle(input: ListComparisonsInput, _ctx: ExecutionContext): Promise<ComparisonListPage> {
    return this.comparisons.list(input.userId, {
      ...(input.tripId !== undefined ? { tripId: input.tripId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
  }
}
