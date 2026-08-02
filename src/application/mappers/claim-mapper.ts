import { Claim, type ClaimProps } from '@/domain/claim/Claim';
import type { ClaimRecord, ClaimPatch, NewClaimInput } from '@/application/ports/ClaimRepository';

/** The boundary between the `Claim` aggregate and its persisted row. */
export function toClaimProps(record: ClaimRecord): ClaimProps {
  return {
    id: record.id,
    userId: record.userId,
    bookingId: record.bookingId,
    competingRateId: record.competingRateId,
    kind: record.kind,
    deadlineAt: record.deadlineAt,
    status: record.status,
    claimedGapCents: record.claimedGapCents,
    awardedCents: record.awardedCents,
    submittedAt: record.submittedAt,
    resolvedAt: record.resolvedAt,
    denialReason: record.denialReason,
    notes: record.notes,
  };
}

export function toNewClaimInput(claim: Claim): NewClaimInput {
  return {
    id: claim.id,
    userId: claim.userId,
    bookingId: claim.bookingId,
    competingRateId: claim.competingRateId,
    kind: claim.kind,
    deadlineAt: claim.deadlineAt,
    status: claim.status,
    claimedGapCents: claim.claimedGapCents,
  };
}

/** Everything a mutated `Claim` aggregate needs written back — a full-state patch. */
export function toClaimPatch(claim: Claim): ClaimPatch {
  return {
    competingRateId: claim.competingRateId,
    status: claim.status,
    awardedCents: claim.awardedCents,
    submittedAt: claim.submittedAt,
    resolvedAt: claim.resolvedAt,
    denialReason: claim.denialReason,
    notes: claim.notes,
  };
}
