import { Claim } from '@/domain/claim/Claim';
import type { Clock } from '@/domain/shared/Clock';
import { formatDateTime } from '@/lib/format';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { ClaimRepository } from '@/application/ports/ClaimRepository';
import type { Notifier } from '@/application/ports/Notifier';
import { isWithinQuietHours } from '@/infrastructure/notifications/quiet-hours';
import { toClaimPatch, toClaimProps } from '../../mappers/claim-mapper';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../../shared/UseCase';

/**
 * §9's reminder checkpoints, measured as hours elapsed since `bookedAt`.
 * Not a `RuleConstant` in `domain/rules/` — these govern *when a job runs*,
 * not a programme term the user would ever flag as changed (§2.8), so they
 * don't belong on `/settings/rules` the way `PM_CLAIM_WINDOW_HOURS_RULE` does.
 */
export const CLAIM_NOTIFY_CHECKPOINT_HOURS: readonly number[] = [1, 6, 20];

/**
 * The last checkpoint — the T+20h "final call" before the 24h deadline
 * (PM5, §2.3.1) and the highest-value reminder in the product. Quiet hours
 * are not allowed to cost this one outright; see the exemption at the notify
 * loop below.
 */
const FINAL_CHECKPOINT_HOURS = CLAIM_NOTIFY_CHECKPOINT_HOURS[CLAIM_NOTIFY_CHECKPOINT_HOURS.length - 1];

export interface ClaimDeadlineSweepInput {
  readonly dryRun: boolean;
}

export interface ClaimDeadlineSweepOutput {
  readonly dryRun: boolean;
  readonly claimsScanned: number;
  readonly expired: number;
  readonly notified: number;
  readonly deduped: number;
  readonly skippedQuietHours: number;
  /** Of `skippedQuietHours`'s candidates, how many were the T+20h final
   *  checkpoint sent anyway because the claim's deadline itself falls inside
   *  the same quiet-hours window — see the notify loop below. */
  readonly quietHoursExempted: number;
}

/**
 * `claim-deadline-sweep` — every 15 minutes (§9).
 *
 * Two independent responsibilities per open claim:
 *
 * 1. **Auto-expire.** `Claim.expireIfPastDeadline` is already idempotent by
 *    construction (§7.4: it no-ops once the claim is terminal), so running
 *    this sweep twice in the same tick transitions a given claim at most once
 *    — no extra bookkeeping needed here.
 * 2. **Reminders at T+1h/T+6h/T+20h.** §4.2's `claims` table has no
 *    "notifications sent" column to persist against, so *every* checkpoint
 *    whose threshold has been crossed is re-evaluated on every run —
 *    deliberately a wide, not a narrow, "due" window. That is what makes a
 *    checkpoint delayed by quiet hours or a missed tick still go out on a
 *    later run rather than being silently skipped forever, *provided*
 *    exactly-once delivery per checkpoint actually holds once that later run
 *    happens. It didn't, in production: that guarantee used to rest entirely
 *    on `IdempotentNotifier`'s in-process `Map`, which is empty on every
 *    serverless cold start — routine on a job with a 15-minute cadence — so
 *    the same checkpoint could and did re-send on every tick for as long as
 *    a claim stayed open. `DurableIdempotentNotifier` (wired in
 *    `createNotifier.ts`, backed by the `notifications_sent` table) is what
 *    makes each checkpoint's `claim-deadline:{claimId}:{h}h` idempotency key
 *    durable across that gap, so "never more than three notifications per
 *    claim" — there being exactly three keys — now actually holds in the
 *    deployed environment, not only within one warm process.
 *
 * **Quiet hours delay a checkpoint, they do not drop it.** The wide due
 * window above means a checkpoint skipped for quiet hours is still due on
 * the next tick, and now that dedup survives the gap between ticks, that
 * later send is still exactly the checkpoint's one legitimate delivery
 * rather than a risk of double-sending it — `ClaimDeadlineSweepUseCase.test.ts`
 * exercises this end to end (skip → later tick sends → no further resend)
 * rather than assuming it. The one exception is the T+20h final checkpoint:
 * see the inline comment at the notify loop for why it is exempted from
 * quiet hours outright, rather than merely delayed, in the one case where
 * delaying it would mean it never fires at all.
 */
export class ClaimDeadlineSweepUseCase extends CommandUseCase<ClaimDeadlineSweepInput, ClaimDeadlineSweepOutput> {
  public readonly name = 'claim_deadline_sweep';

  constructor(
    deps: UseCaseDependencies,
    private readonly claims: ClaimRepository,
    private readonly notifier: Notifier,
  ) {
    super(deps);
  }

  protected async handle(
    input: ClaimDeadlineSweepInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<ClaimDeadlineSweepOutput> {
    const rows = await this.claims.listOpenForSweep(ctx.now);
    const clock: Clock = { now: () => ctx.now };

    let expired = 0;
    let notified = 0;
    let deduped = 0;
    let skippedQuietHours = 0;
    let quietHoursExempted = 0;

    for (const row of rows) {
      const claim = Claim.rehydrate(toClaimProps(row.claim));

      if (claim.expireIfPastDeadline(clock)) {
        expired += 1;
        // §9: a dry run has zero side effects, so the transition itself is
        // skipped too, not just the notification — only `expired` in the
        // returned summary reflects what a real run would do.
        if (!input.dryRun) {
          await this.claims.update(claim.id, claim.userId, toClaimPatch(claim));
        }
        logger.info(input.dryRun ? 'claim would auto-expire (dry run)' : 'claim auto-expired', {
          claimId: claim.id,
          deadlineAt: claim.deadlineAt.toISOString(),
        });
        continue;
      }

      const elapsedHours = (ctx.now.getTime() - row.bookedAt.getTime()) / (60 * 60 * 1000);
      const inQuietHours = isWithinQuietHours(ctx.now, row.userTimezone);

      for (const checkpoint of CLAIM_NOTIFY_CHECKPOINT_HOURS) {
        if (elapsedHours < checkpoint) continue;

        // §9 + this task: quiet hours delay a checkpoint, they do not drop
        // it — normally we just skip and let the next tick re-evaluate this
        // same "due" checkpoint (the wide window above), which is safe now
        // that dedup is durable: skipping consumes no idempotency key, so
        // the eventual send still happens exactly once.
        //
        // The T+20h checkpoint is the one case that cannot be left to "the
        // next tick." By construction it only ever becomes due with at most
        // 4 hours left before the claim auto-expires: this loop is
        // unreachable once `expireIfPastDeadline` has fired above, so
        // `elapsedHours` is always in `[20, 24)` here. A 4-hour gap is
        // smaller than both the quiet-hours band itself (11h, 21:00–08:00)
        // and the ~13h gap between successive bands, so if `now` and the
        // deadline are both inside quiet hours they are provably inside the
        // *same* contiguous quiet-hours instance — there is no room for
        // quiet hours to end and restart in between. That is what makes
        // "is the deadline itself still inside quiet hours" a safe, cheap
        // proxy for "will quiet hours still be running when this claim
        // expires," without needing timezone-aware "time until quiet hours
        // ends" arithmetic. When that holds, delaying would mean the user's
        // highest-value reminder — the last chance to submit before a claim
        // worth real money silently expires — never fires at all. §9 treats
        // a 3 a.m. email as a product failure, but a silently expired claim
        // is the bigger one, so this one checkpoint is exempted from quiet
        // hours entirely in that case; every other checkpoint keeps the
        // normal delay-to-next-tick behaviour.
        const isFinalCheckpoint = checkpoint === FINAL_CHECKPOINT_HOURS;
        const finalCheckpointExemption =
          isFinalCheckpoint && inQuietHours && isWithinQuietHours(claim.deadlineAt, row.userTimezone);

        if (inQuietHours && !finalCheckpointExemption) {
          skippedQuietHours += 1;
          continue;
        }
        if (finalCheckpointExemption) quietHoursExempted += 1;

        const result = await this.notifier.send({
          to: row.userEmail,
          subject: `Price-match claim due by ${formatDateTime(claim.deadlineAt, row.userTimezone)}`,
          text:
            `Your ${claim.kind} claim is ${checkpoint}+ hours since booking. ` +
            `Submit by ${formatDateTime(claim.deadlineAt, row.userTimezone)} or the window closes. ` +
            'This is an estimate, not a guarantee of approval.',
          idempotencyKey: `claim-deadline:${claim.id}:${checkpoint}h`,
          userId: claim.userId,
        });

        if (result.deduped) deduped += 1;
        else if (result.sent) notified += 1;
      }
    }

    logger.info('claim-deadline-sweep complete', {
      dryRun: input.dryRun,
      claimsScanned: rows.length,
      quietHoursExempted,
      expired,
      notified,
      deduped,
      skippedQuietHours,
    });

    return {
      dryRun: input.dryRun,
      claimsScanned: rows.length,
      expired,
      notified,
      deduped,
      skippedQuietHours,
      quietHoursExempted,
    };
  }
}
