import type { ClaimStatus } from '@/domain/claim/ClaimStatus';

/**
 * Shared between `ClaimQueue` and `ClaimKit` so the two screens agree on what
 * colour a status reads as. Not a `src/lib/format.ts` formatter (it maps to a
 * `Badge` variant, not to text), so it lives here rather than there.
 */
export const CLAIM_STATUS_BADGE_VARIANT: Readonly<Record<ClaimStatus, 'neutral' | 'good' | 'warning' | 'critical'>> =
  Object.freeze({
    ELIGIBLE: 'neutral',
    PREPARING: 'neutral',
    SUBMITTED: 'warning',
    APPROVED: 'good',
    PARTIAL: 'good',
    DENIED: 'critical',
    EXPIRED: 'critical',
    NOT_PURSUED: 'neutral',
  });
