import { addDays } from '@/domain/shared/Clock';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import { formatDate } from '@/lib/format';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { WatchlistRepository } from '@/application/ports/WatchlistRepository';
import type { Notifier } from '@/application/ports/Notifier';
import { isWithinQuietHours } from '@/infrastructure/notifications/quiet-hours';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../../shared/UseCase';

/** §9: a reminder that arrives with no time left to act on it is noise. */
export const RESHOP_MIN_DAYS_TO_CANCEL_DEADLINE = 2;

export interface WatchlistReshopInput {
  readonly dryRun: boolean;
}

export interface WatchlistReshopOutput {
  readonly dryRun: boolean;
  readonly due: number;
  readonly notified: number;
  readonly skippedDeadlineTooClose: number;
  readonly skippedQuietHours: number;
}

/**
 * `watchlist-reshop` — daily 09:00 (§9).
 *
 * Idempotency here needs none of the checkpoint machinery the other two jobs
 * use: `WatchlistRepository.claimDueForSweep` *atomically* reads and advances
 * `next_check_at` in one `UPDATE … RETURNING` (see that port's doc), so a row
 * this call returns has already been consumed — a concurrent second sweep
 * cannot also claim it, full stop. The one trade-off worth naming: skipping a
 * claimed row's send because of quiet hours does not un-claim it, so that
 * user's reminder for *this* cycle is silently absorbed rather than retried
 * a few hours later — acceptable at a weekly-default cadence (`cadence_days`)
 * for a re-shop nudge, where a `claim-deadline-sweep`-style multi-hour retry
 * window would be overkill; the low stakes here (unlike a 24-hour price-match
 * cutoff) is exactly what makes the simpler mechanism the right one.
 *
 * `userId` on the message lets `DurableIdempotentNotifier` durably claim this
 * idempotency key in `notifications_sent` before sending — the same
 * cold-start protection `ClaimDeadlineSweepUseCase` needed, applied here too
 * since this job shares the one `Notifier` singleton (`createNotifier.ts`).
 */
export class WatchlistReshopUseCase extends CommandUseCase<WatchlistReshopInput, WatchlistReshopOutput> {
  public readonly name = 'watchlist_reshop';

  constructor(
    deps: UseCaseDependencies,
    private readonly watchlist: WatchlistRepository,
    private readonly notifier: Notifier,
  ) {
    super(deps);
  }

  protected async handle(
    input: WatchlistReshopInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<WatchlistReshopOutput> {
    // A dry run must have zero side effects (§9), including never advancing
    // `next_check_at` — so it previews with `peekDueForSweep` instead of the
    // atomic claim-and-advance read, reporting what *would* be due.
    const due = input.dryRun
      ? await this.watchlist.peekDueForSweep(ctx.now)
      : await this.watchlist.claimDueForSweep(ctx.now);

    let notified = 0;
    let skippedDeadlineTooClose = 0;
    let skippedQuietHours = 0;

    const minDeadline = toIsoDate(addDays(ctx.now, RESHOP_MIN_DAYS_TO_CANCEL_DEADLINE));

    for (const row of due) {
      if (!row.cancelDeadline || row.cancelDeadline < minDeadline) {
        skippedDeadlineTooClose += 1;
        continue;
      }

      if (isWithinQuietHours(ctx.now, row.userTimezone)) {
        skippedQuietHours += 1;
        continue;
      }

      const deepLink = row.comparisonId
        ? `/compare?fromComparison=${row.comparisonId}`
        : `/compare?property=${encodeURIComponent(row.propertyNameSnapshot)}`;

      const result = await this.notifier.send({
        to: row.userEmail,
        subject: `Worth a re-shop: ${row.propertyNameSnapshot}`,
        text:
          `Your ${row.checkIn} to ${row.checkOut} stay at ${row.propertyNameSnapshot} is still cancellable ` +
          `until ${formatDate(row.cancelDeadline)}. Rates move — check today's price at ${deepLink}.`,
        idempotencyKey: `watchlist-reshop:${row.entry.id}:${toIsoDate(ctx.now)}`,
        userId: row.entry.userId,
      });

      if (result.sent) notified += 1;
    }

    logger.info('watchlist-reshop complete', {
      dryRun: input.dryRun,
      due: due.length,
      notified,
      skippedDeadlineTooClose,
      skippedQuietHours,
    });

    return { dryRun: input.dryRun, due: due.length, notified, skippedDeadlineTooClose, skippedQuietHours };
  }
}
