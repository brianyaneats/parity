import type { Logger } from '@/infrastructure/observability/Logger';
import type { WatchlistRepository } from '@/application/ports/WatchlistRepository';
import { ApiError } from '@/lib/api/errors';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface DeleteWatchlistInput {
  readonly id: string;
  readonly userId: string;
}

export interface DeleteWatchlistOutput {
  readonly id: string;
}

/** `DELETE /api/watchlist?id=` — §7.6. */
export class DeleteWatchlistUseCase extends CommandUseCase<DeleteWatchlistInput, DeleteWatchlistOutput> {
  public readonly name = 'delete_watchlist';

  constructor(
    deps: UseCaseDependencies,
    private readonly watchlistRepository: WatchlistRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: DeleteWatchlistInput,
    _ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<DeleteWatchlistOutput> {
    const deleted = await this.watchlistRepository.delete(input.id, input.userId);
    if (!deleted) throw ApiError.notFound('Watchlist entry');
    return { id: input.id };
  }
}
