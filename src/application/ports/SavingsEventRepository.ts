import type { Cents } from '@/domain/shared/cents';

export type SavingsEventKind =
  | 'CHANNEL_CHOICE'
  | 'PRICE_MATCH'
  | 'CREDIT_BURNED'
  | 'BRG'
  | 'RESHOP'
  | 'PERK';

export interface SavingsEventRecord {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string | null;
  readonly claimId: string | null;
  readonly kind: SavingsEventKind;
  readonly amountCents: Cents;
  readonly realized: boolean;
  readonly occurredOn: string;
  readonly note: string | null;
}

export interface NewSavingsEventInput {
  readonly userId: string;
  readonly bookingId?: string | null;
  readonly claimId?: string | null;
  readonly kind: SavingsEventKind;
  readonly amountCents: Cents;
  readonly realized: boolean;
  readonly occurredOn: string;
  readonly note?: string | null;
}

export interface SavingsEventListFilter {
  readonly from?: string;
  readonly to?: string;
  readonly realized?: boolean;
}

export interface SavingsEventAggregates {
  readonly totalCents: Cents;
  readonly realizedCents: Cents;
  readonly projectedCents: Cents;
  readonly count: number;
}

export interface SavingsEventListResult {
  readonly items: readonly SavingsEventRecord[];
  readonly aggregates: SavingsEventAggregates;
}

/** `SavingsEventRepository` — port over `savings_events` (§4.2, §1.5's auditable ledger). */
export interface SavingsEventRepository {
  create(input: NewSavingsEventInput): Promise<SavingsEventRecord>;
  list(userId: string, filter: SavingsEventListFilter): Promise<SavingsEventListResult>;
}
