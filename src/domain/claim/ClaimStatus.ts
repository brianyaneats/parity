/**
 * Claim lifecycle — §7.4, DECISIONS.md D-034.
 *
 * The state machine lives here as a declarative table so the rule is stated
 * once and enforced identically by the API, the UI and the cron sweep. §7.4's
 * acceptance criterion — "an expired claim can no longer be marked SUBMITTED,
 * only EXPIRED or NOT_PURSUED" — is the reason: a rule re-implemented in three
 * places is a rule that will disagree with itself in one of them.
 */

export type ClaimStatus =
  | 'ELIGIBLE'
  | 'PREPARING'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PARTIAL'
  | 'DENIED'
  | 'EXPIRED'
  | 'NOT_PURSUED';

export const CLAIM_STATUSES: readonly ClaimStatus[] = Object.freeze([
  'ELIGIBLE',
  'PREPARING',
  'SUBMITTED',
  'APPROVED',
  'PARTIAL',
  'DENIED',
  'EXPIRED',
  'NOT_PURSUED',
]);

/** Statuses from which nothing further can happen. */
export const TERMINAL_STATUSES: ReadonlySet<ClaimStatus> = Object.freeze(
  new Set<ClaimStatus>(['APPROVED', 'PARTIAL', 'DENIED', 'EXPIRED', 'NOT_PURSUED']),
);

/** Statuses the deadline sweep in Part 9 still notifies about. */
export const OPEN_STATUSES: ReadonlySet<ClaimStatus> = Object.freeze(
  new Set<ClaimStatus>(['ELIGIBLE', 'PREPARING']),
);

/** Outcomes that require an awarded amount and write a realised savings event. */
export const RESOLVED_WITH_AWARD: ReadonlySet<ClaimStatus> = Object.freeze(
  new Set<ClaimStatus>(['APPROVED', 'PARTIAL']),
);

export const ALLOWED_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> =
  Object.freeze({
    ELIGIBLE: ['PREPARING', 'SUBMITTED', 'NOT_PURSUED', 'EXPIRED'],
    PREPARING: ['SUBMITTED', 'NOT_PURSUED', 'EXPIRED'],
    // A submitted claim is out of the user's hands; only the issuer's answer
    // moves it. It is deliberately not expirable — the 24-hour window governs
    // *submission*, not the issuer's response time.
    SUBMITTED: ['APPROVED', 'PARTIAL', 'DENIED'],
    APPROVED: [],
    PARTIAL: [],
    DENIED: [],
    EXPIRED: [],
    NOT_PURSUED: [],
  });

export const CLAIM_STATUS_LABELS: Readonly<Record<ClaimStatus, string>> = Object.freeze({
  ELIGIBLE: 'Eligible',
  PREPARING: 'Preparing',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  PARTIAL: 'Partially approved',
  DENIED: 'Denied',
  EXPIRED: 'Expired',
  NOT_PURSUED: 'Not pursued',
});

export function isTransitionAllowed(from: ClaimStatus, to: ClaimStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
