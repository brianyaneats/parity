import { daysBetween } from '../shared/Clock';
import { CREDIT_POSTING_SETTLING_DAYS, CREDIT_POSTING_ABANDON_DAYS } from '../rules/posting.rules';

/**
 * Posting classification — turns a `credit_postings` row into "what should the
 * user see", per `posting.rules.ts`'s own framing: the rest of this app tracks
 * whether a credit was *spent*, this answers whether it *came back*.
 *
 * `CreditPostingStatus` mirrors `creditPostingStatusEnum` in
 * `src/infrastructure/persistence/schema.ts` exactly, but is declared here
 * rather than imported from it — this module is domain, and domain imports
 * nothing from infrastructure. Schema is the dependent side; if the two ever
 * drift, `tsc` catches it at the query/action boundary where a raw DB row is
 * narrowed to this type.
 */
export type CreditPostingStatus = 'PENDING' | 'POSTED' | 'MISSING' | 'DISPUTED' | 'WRITTEN_OFF';

/**
 * The state actually worth showing. `PENDING` and `MISSING` both still run
 * against the settling/abandon clock — a manual "missing" flag records that
 * the user already looked once, it does not stop time from continuing to make
 * the case worse, so both collapse into the same three day-based bands below.
 */
export type CreditPostingDerivedState = 'SETTLING' | 'OVERDUE' | 'STALE' | 'POSTED' | 'DISPUTED' | 'WRITTEN_OFF';

export interface CreditPostingSnapshot {
  /** ISO `YYYY-MM-DD` — the charge date, the clock the settling period runs from. */
  readonly chargedOn: string;
  readonly status: CreditPostingStatus;
}

/**
 * Whole days from the charge to `now`, truncated toward zero via
 * `Clock.daysBetween` — the same UTC-midnight comparison `CreditWindow`'s own
 * day-count functions use, so a user in Tokyo and a user in New York agree on
 * which day a posting became overdue.
 */
export function daysSinceCharge(chargedOn: string, now: Date): number {
  return daysBetween(new Date(`${chargedOn}T00:00:00Z`), now);
}

/**
 * Classifies a posting for display. `POSTED`/`DISPUTED`/`WRITTEN_OFF` pass
 * straight through — those are resolutions, not ongoing states. `PENDING` and
 * `MISSING` are banded by `daysSinceCharge` against the two constants
 * `posting.rules.ts` documents:
 *
 * - `SETTLING`: at or under `CREDIT_POSTING_SETTLING_DAYS` (14) — still normal,
 *   nothing to chase yet.
 * - `OVERDUE`: past settling, at or under `CREDIT_POSTING_ABANDON_DAYS` (70) —
 *   abnormal; the user should start chasing.
 * - `STALE`: past `CREDIT_POSTING_ABANDON_DAYS` — very unlikely to post
 *   unaided; escalate or write off.
 *
 * Both boundaries land on the *lower* band (day 14 is still `SETTLING`, day 70
 * is still `OVERDUE`) — the same "boundary belongs to the calmer side" choice
 * `CreditBucket.status` makes for its own day-band boundaries, so a credit
 * doesn't get flagged abnormal on the exact day the rule still calls normal.
 */
export function classifyPosting(snapshot: CreditPostingSnapshot, now: Date): CreditPostingDerivedState {
  switch (snapshot.status) {
    case 'POSTED':
      return 'POSTED';
    case 'DISPUTED':
      return 'DISPUTED';
    case 'WRITTEN_OFF':
      return 'WRITTEN_OFF';
    case 'PENDING':
    case 'MISSING': {
      const days = daysSinceCharge(snapshot.chargedOn, now);
      if (days > CREDIT_POSTING_ABANDON_DAYS) return 'STALE';
      if (days > CREDIT_POSTING_SETTLING_DAYS) return 'OVERDUE';
      return 'SETTLING';
    }
    default: {
      const exhaustive: never = snapshot.status;
      throw new Error(`Unhandled credit posting status: ${String(exhaustive)}`);
    }
  }
}

/** Whether this posting still needs the user's eyes — the `/credits` attention section's own filter. */
export function isOutstanding(status: CreditPostingStatus): boolean {
  return status === 'PENDING' || status === 'MISSING';
}
