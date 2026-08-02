import { CreditBucket, type BucketStatus } from '@/domain/credit/CreditBucket';
import type { DateWindow } from '@/domain/credit/CreditWindow';
import type { Cents } from '@/domain/shared/cents';
import type { CreditBucketRecord } from '@/application/ports/CreditBucketRepository';

/**
 * Shared credit-bucket read model — used by `ListBucketsUseCase` and
 * `ConsumeBucketUseCase` so the "rehydrate the aggregate, read its computed
 * fields" step exists in exactly one place (§2.4: never re-derive the
 * clawback/expiry formulas at a call site).
 */
export interface CreditBucketView {
  readonly id: string;
  readonly userId: string;
  readonly cardId: string | null;
  readonly key: string;
  readonly label: string;
  readonly faceCents: Cents;
  readonly window: DateWindow;
  readonly consumedCents: Cents;
  readonly remainingCents: Cents;
  readonly daysRemaining: number;
  readonly status: BucketStatus;
}

/** Rehydrates the `CreditBucket` aggregate from a stored record. */
export function toCreditBucketAggregate(record: CreditBucketRecord): CreditBucket {
  return CreditBucket.create({
    id: record.id,
    userId: record.userId,
    cardId: record.cardId,
    key: record.key,
    label: record.label,
    faceCents: record.faceCents,
    window: record.window,
    consumedCents: record.consumedCents,
  });
}

/** Projects a rehydrated aggregate into the view the `/credits` screen reads. */
export function toBucketView(bucket: CreditBucket, todayIso: string): CreditBucketView {
  return {
    id: bucket.id,
    userId: bucket.userId,
    cardId: bucket.cardId,
    key: bucket.key,
    label: bucket.label,
    faceCents: bucket.faceCents,
    window: bucket.window,
    consumedCents: bucket.consumedCents,
    remainingCents: bucket.remainingCents,
    daysRemaining: bucket.daysRemaining(todayIso),
    status: bucket.status(todayIso),
  };
}
