import type { Logger } from '@/infrastructure/observability/Logger';
import type { PropertyRecord, PropertyRepository } from '@/application/ports/PropertyRepository';
import type { PropertySearchQuery } from '@/lib/validation/properties';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface SearchPropertiesInput extends PropertySearchQuery {
  readonly userId: string;
}

/**
 * `GET /api/properties` — §7.3 item 1, §8.5.
 *
 * A thin wrapper: the shadow-by-name dedup between the seeded global rows and
 * the caller's own edits (§7.8) lives in `PropertyRepository.search`, not
 * here.
 */
export class SearchPropertiesUseCase extends QueryUseCase<
  SearchPropertiesInput,
  readonly PropertyRecord[]
> {
  public readonly name = 'search_properties';

  constructor(
    deps: UseCaseDependencies,
    private readonly propertyRepository: PropertyRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: SearchPropertiesInput,
    _ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<readonly PropertyRecord[]> {
    return this.propertyRepository.search(input.userId, {
      q: input.q,
      city: input.city,
      limit: input.limit,
    });
  }

  protected override describeInput(input: SearchPropertiesInput) {
    return { hasQuery: input.q !== undefined, city: input.city ?? null, limit: input.limit ?? null };
  }
}
