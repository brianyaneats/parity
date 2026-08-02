import type { Logger } from '@/infrastructure/observability/Logger';
import type { CreditBucketRepository } from '@/application/ports/CreditBucketRepository';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';
import { toBucketView, toCreditBucketAggregate, type CreditBucketView } from '../mappers/credit-bucket-mapper';

export interface ListBucketsInput {
  readonly userId: string;
}

/**
 * `GET /api/buckets` — §7.5.
 *
 * Rehydrates each stored record into a `CreditBucket` aggregate purely to
 * read its computed `remainingCents`/`daysRemaining`/`status` — the clawback
 * and expiry formulas live in exactly one place (§2.4) and are never
 * re-derived here.
 */
export class ListBucketsUseCase extends QueryUseCase<ListBucketsInput, readonly CreditBucketView[]> {
  public readonly name = 'list_buckets';

  constructor(
    deps: UseCaseDependencies,
    private readonly creditBucketRepository: CreditBucketRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: ListBucketsInput,
    ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<readonly CreditBucketView[]> {
    const records = await this.creditBucketRepository.listByUser(input.userId);
    const todayIso = toIsoDate(ctx.now);
    return records.map((record) => toBucketView(toCreditBucketAggregate(record), todayIso));
  }
}
