import type { Logger } from '@/infrastructure/observability/Logger';
import type { WatchlistRecord, WatchlistRepository } from '@/application/ports/WatchlistRepository';
import type { CreateWatchlistInput as CreateWatchlistPayload } from '@/lib/validation/watchlist';
import { addDays } from '@/domain/shared/Clock';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

/**
 * Matches the `watchlist.cadence_days` column default — §4.2. Exported so
 * `RecordBookingUseCase` schedules the *first* re-shop check on the same
 * cadence a manually-created watchlist row would get, rather than a second,
 * independently-chosen default drifting out of sync with this one.
 */
export const DEFAULT_CADENCE_DAYS = 7;

export interface CreateWatchlistInput extends CreateWatchlistPayload {
  readonly userId: string;
}

/**
 * `POST /api/watchlist` — §7.6.
 *
 * Schedules the first re-shop check `cadenceDays` out from "now", read once
 * from `ctx.now` so the whole task agrees on the same instant.
 */
export class CreateWatchlistUseCase extends CommandUseCase<CreateWatchlistInput, WatchlistRecord> {
  public readonly name = 'create_watchlist';

  constructor(
    deps: UseCaseDependencies,
    private readonly watchlistRepository: WatchlistRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: CreateWatchlistInput,
    ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<WatchlistRecord> {
    const cadenceDays = input.cadenceDays ?? DEFAULT_CADENCE_DAYS;

    return this.watchlistRepository.create({
      userId: input.userId,
      bookingId: input.bookingId,
      cadenceDays,
      nextCheckAt: addDays(ctx.now, cadenceDays),
    });
  }

  protected override describeInput(input: CreateWatchlistInput) {
    return { cadenceDays: input.cadenceDays ?? DEFAULT_CADENCE_DAYS };
  }
}
