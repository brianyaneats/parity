import type { Cents } from '@/domain/shared/cents';
import type { ClaimKind } from '@/domain/claim/Claim';
import type { ClaimStatus } from '@/domain/claim/ClaimStatus';
import type { DenialCode } from '@/domain/claim/DenialReason';

export type { ClaimKind, ClaimStatus };

export interface ClaimRecord {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string;
  readonly competingRateId: string | null;
  readonly kind: ClaimKind;
  readonly deadlineAt: Date;
  readonly status: ClaimStatus;
  readonly claimedGapCents: Cents | null;
  readonly awardedCents: Cents | null;
  readonly submittedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly denialReason: string | null;
  readonly denialCode: DenialCode | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

export interface NewClaimInput {
  readonly id: string;
  readonly userId: string;
  readonly bookingId: string;
  readonly competingRateId: string | null;
  readonly kind: ClaimKind;
  readonly deadlineAt: Date;
  readonly status: ClaimStatus;
  readonly claimedGapCents: Cents | null;
}

/**
 * Everything a claim transition can change. The route/use case always derives
 * this from `Claim.transitionTo` (or `Claim.attachCompetingRate` /
 * `expireIfPastDeadline`) having already run — the repository never decides
 * the state machine, it only persists what the aggregate decided (§7.4).
 */
export interface ClaimPatch {
  readonly competingRateId?: string | null;
  readonly status?: ClaimStatus;
  readonly awardedCents?: Cents | null;
  readonly submittedAt?: Date | null;
  readonly resolvedAt?: Date | null;
  readonly denialReason?: string | null;
  readonly denialCode?: DenialCode | null;
  readonly notes?: string | null;
}

export interface ClaimListFilter {
  readonly status?: readonly ClaimStatus[];
  /** Milliseconds. Only claims whose deadline is within this window from `now`. */
  readonly dueWithinMs?: number;
  readonly now: Date;
}

/**
 * One open claim plus what the cron sweep needs to notify and to compute
 * elapsed time, without an N+1 query per claim.
 */
export interface ClaimSweepRow {
  readonly claim: ClaimRecord;
  readonly bookedAt: Date;
  readonly userEmail: string;
  readonly userTimezone: string;
}

export interface ClaimRepository {
  create(input: NewClaimInput): Promise<ClaimRecord>;
  findById(id: string, userId: string): Promise<ClaimRecord | null>;
  list(userId: string, filter: ClaimListFilter): Promise<readonly ClaimRecord[]>;
  update(id: string, userId: string, patch: ClaimPatch): Promise<ClaimRecord | null>;

  /**
   * Every `ELIGIBLE`/`PREPARING` claim across every user, joined with the
   * owning booking's `bookedAt` and the recipient's email/timezone — the
   * `claim-deadline-sweep` job's read (§9).
   */
  listOpenForSweep(now: Date): Promise<readonly ClaimSweepRow[]>;
}
