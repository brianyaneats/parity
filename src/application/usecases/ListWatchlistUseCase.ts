import type { Logger } from '@/infrastructure/observability/Logger';
import type { WatchlistRecord, WatchlistRepository } from '@/application/ports/WatchlistRepository';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface ListWatchlistInput {
  readonly userId: string;
}

/** `GET /api/watchlist` — §7.6. */
export class ListWatchlistUseCase extends QueryUseCase<
  ListWatchlistInput,
  readonly WatchlistRecord[]
> {
  public readonly name = 'list_watchlist';

  constructor(
    deps: UseCaseDependencies,
    private readonly watchlistRepository: WatchlistRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: ListWatchlistInput,
    _ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<readonly WatchlistRecord[]> {
    return this.watchlistRepository.listByUser(input.userId);
  }
}
