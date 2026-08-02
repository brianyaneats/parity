import { CreditBucket } from '@/domain/credit/CreditBucket';
import { BUCKET_NOTIFY_DAYS_BEFORE } from '@/domain/rules/credit.rules';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import { formatCents, formatDate, formatDays } from '@/lib/format';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { CreditBucketRepository } from '@/application/ports/CreditBucketRepository';
import type { Notifier } from '@/application/ports/Notifier';
import { isWithinQuietHours } from '@/infrastructure/notifications/quiet-hours';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../../shared/UseCase';

export interface BucketExpirySweepInput {
  readonly dryRun: boolean;
}

export interface BucketExpirySweepOutput {
  readonly dryRun: boolean;
  readonly bucketsScanned: number;
  readonly notified: number;
  readonly deduped: number;
  readonly skippedQuietHours: number;
}

/**
 * `bucket-expiry-sweep` — daily 09:00 (§9).
 *
 * "At 60, 30, 14, and 3 days before a bucket's window ends with remaining > 0,
 * notify with the amount and one suggested action." Same "wide due window +
 * idempotency-keyed notifier" shape as `ClaimDeadlineSweepUseCase` — see that
 * file's module doc for the full reasoning, which applies here unchanged:
 * `daysRemaining <= checkpoint` stays true for the rest of that checkpoint's
 * band, so a run skipped by quiet hours or a missed tick is caught by the
 * next one, and `bucket-expiry:{bucketId}:{checkpoint}d:{windowEnd}` ensures
 * at most one email per checkpoint per bucket — durably, across a cold start,
 * via `DurableIdempotentNotifier` (see that class's module doc for why the
 * in-process `IdempotentNotifier` map alone was not enough on serverless).
 * `userId` on the message attributes that ledger row to this bucket's owner.
 */
export class BucketExpirySweepUseCase extends CommandUseCase<BucketExpirySweepInput, BucketExpirySweepOutput> {
  public readonly name = 'bucket_expiry_sweep';

  constructor(
    deps: UseCaseDependencies,
    private readonly creditBuckets: CreditBucketRepository,
    private readonly notifier: Notifier,
  ) {
    super(deps);
  }

  protected async handle(
    input: BucketExpirySweepInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<BucketExpirySweepOutput> {
    const rows = await this.creditBuckets.listForExpirySweep(ctx.now);
    const today = toIsoDate(ctx.now);

    let notified = 0;
    let deduped = 0;
    let skippedQuietHours = 0;

    for (const row of rows) {
      const bucket = CreditBucket.create({
        id: row.bucket.id,
        userId: row.bucket.userId,
        cardId: row.bucket.cardId,
        key: row.bucket.key,
        label: row.bucket.label,
        faceCents: row.bucket.faceCents,
        window: row.bucket.window,
        consumedCents: row.bucket.consumedCents,
      });

      if (bucket.isExhausted) continue;

      const daysRemaining = bucket.daysRemaining(today);
      if (daysRemaining < 0) continue;

      const inQuietHours = isWithinQuietHours(ctx.now, row.userTimezone);

      for (const checkpoint of BUCKET_NOTIFY_DAYS_BEFORE) {
        if (daysRemaining > checkpoint) continue;

        if (inQuietHours) {
          skippedQuietHours += 1;
          continue;
        }

        const result = await this.notifier.send({
          to: row.userEmail,
          subject: `${formatCents(bucket.remainingCents)} of ${bucket.label} expires ${formatDate(bucket.window.end)}`,
          text:
            `${formatCents(bucket.remainingCents)} of your ${bucket.label} credit is unused with ` +
            `${formatDays(daysRemaining)} left. Book a prepaid stay through the eligible channel ` +
            'before it resets, or it is gone. This is an estimate, not a guarantee.',
          idempotencyKey: `bucket-expiry:${bucket.id}:${checkpoint}d:${bucket.window.end}`,
          userId: bucket.userId,
        });

        if (result.deduped) deduped += 1;
        else if (result.sent) notified += 1;
      }
    }

    logger.info('bucket-expiry-sweep complete', {
      dryRun: input.dryRun,
      bucketsScanned: rows.length,
      notified,
      deduped,
      skippedQuietHours,
    });

    return { dryRun: input.dryRun, bucketsScanned: rows.length, notified, deduped, skippedQuietHours };
  }
}
