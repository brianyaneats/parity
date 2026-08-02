import type { Cents } from '@/domain/shared/cents';
import type { DateWindow } from '@/domain/credit/CreditWindow';

export interface CreditBucketRecord {
  readonly id: string;
  readonly userId: string;
  readonly cardId: string | null;
  readonly key: string;
  readonly label: string;
  readonly faceCents: Cents;
  readonly window: DateWindow;
  readonly consumedCents: Cents;
}

export interface NewCreditBucketInput {
  readonly userId: string;
  readonly cardId?: string | null;
  readonly key: string;
  readonly label: string;
  readonly faceCents: Cents;
  readonly window: DateWindow;
  readonly consumedCents?: Cents;
}

/** A bucket plus the recipient info the `bucket-expiry-sweep` job needs (§9). */
export interface CreditBucketSweepRow {
  readonly bucket: CreditBucketRecord;
  readonly userEmail: string;
  readonly userTimezone: string;
}

export interface CreditBucketRepository {
  /** Idempotent by `(userId, key, windowStart)` — §4.4, the seed's own contract. */
  upsert(input: NewCreditBucketInput): Promise<CreditBucketRecord>;
  listByUser(userId: string): Promise<readonly CreditBucketRecord[]>;
  findById(id: string, userId: string): Promise<CreditBucketRecord | null>;
  /** Adds to `consumedCents`, capped at `faceCents` by the caller (via the aggregate). */
  setConsumedCents(id: string, userId: string, consumedCents: Cents): Promise<CreditBucketRecord | null>;
  /** Every bucket with `remaining > 0` and a window still open, across every user — §9. */
  listForExpirySweep(now: Date): Promise<readonly CreditBucketSweepRow[]>;
}
