/**
 * `EmailBudgetRepository` — the durable send budget behind
 * `RequestMagicLinkUseCase`.
 *
 * Security-audit finding (BLOCKING #1): `POST /api/auth/magic-link`'s only
 * throttle was `enforceIpRateLimit` (`src/lib/api/rate-limit.ts`) — 5/min and
 * 20/hour per source IP. That bounds one IP's *request rate*, not the
 * *shared resource* those requests spend: Resend's free tier caps the whole
 * deployment at 100 emails/day. Staying entirely within the per-IP hourly
 * limit, one caller who knows (or discovers, via the timing side-channel
 * this same remediation also closes) a single valid registered address can
 * still send it magic-link email every few minutes for a few hours and
 * exhaust the *entire day's* quota — at which point every other user's
 * sign-in email silently fails too. That is a full authentication outage
 * triggered by one anonymous caller, repeatable daily.
 *
 * This port adds the budget the per-IP limiter cannot express, because it
 * has no notion of "total sends today" or "sends to this address today":
 *
 * - **Per-recipient**: at most `RECIPIENT_DAILY_EMAIL_LIMIT` sends to one
 *   address per UTC day, with at least `RECIPIENT_EMAIL_COOLDOWN_MS` between
 *   two sends to that same address — closes the "sit at the per-IP limit for
 *   hours, all aimed at one inbox" path directly, independent of source IP
 *   (which an attacker can rotate; the target address is what's fixed).
 * - **Global**: at most a configurable number of sends per UTC day across
 *   every recipient — the actual Resend budget, with headroom reserved
 *   below the hard 100/day free-tier cap so the deployment's own legitimate
 *   traffic (cron job notifications share the same Resend account) never
 *   gets crowded out.
 *
 * **Durable and cross-instance, not in-process.** `InMemoryRateLimiter`
 * (`rate-limit.ts`) is explicit that its counters are per serverless
 * instance — fine for a soft per-IP throttle, wrong for a hard budget: on
 * Vercel, N warm instances would each allow the full quota again, and every
 * instance forgets its count on a cold start regardless. A Postgres-backed
 * counter (Neon is already provisioned; no new infrastructure) is the one
 * piece of state every instance and every cold start shares.
 *
 * **Atomic, not read-then-write.** Two concurrent callers racing on the same
 * recipient (or, for the global counter, on the same day) must not both
 * observe "under budget" and both proceed — that race is exactly how a cap
 * gets silently exceeded. `reserveSend` is implemented as a single
 * conditional `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE` per counter,
 * inside one transaction — see `DrizzleEmailBudgetRepository` for why that
 * one statement, not a `SELECT` followed by an `UPDATE`, is what makes the
 * check-and-increment atomic under Postgres's row-level locking.
 */

/** Per-recipient: at most this many sends to one address per UTC day. */
export const RECIPIENT_DAILY_EMAIL_LIMIT = 3;

/** Per-recipient: minimum gap between two sends to the same address. */
export const RECIPIENT_EMAIL_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Global ceiling, across every recipient, per UTC day. Overridable via the
 * `EMAIL_DAILY_BUDGET` env var (see `RequestMagicLinkUseCase`) — this is
 * only the default. Deliberately below Resend's 100/day free-tier cap: the
 * four §9 cron jobs also send through the same Resend account, and a budget
 * that only leaves room for magic-link traffic would let this fix itself
 * become the thing that starves a claim-deadline reminder.
 */
export const DEFAULT_GLOBAL_DAILY_EMAIL_LIMIT = 80;

export type EmailBudgetBlockReason = 'RECIPIENT_LIMIT' | 'GLOBAL_LIMIT';

export interface EmailBudgetDecision {
  readonly allowed: boolean;
  /** Present only when `allowed` is `false` — which budget rejected the send. */
  readonly reason?: EmailBudgetBlockReason;
}

export interface EmailBudgetRepository {
  /**
   * Atomically reserves one send to `email` at `now`, honoring both the
   * per-recipient cap/cooldown and the global daily ceiling.
   *
   * `allowed: true` means both counters were incremented and the caller
   * should actually send. `allowed: false` means *neither* counter was
   * left incremented — a per-recipient block does not spend a global-budget
   * slot, and (see the Drizzle implementation) a global block rolls back a
   * per-recipient increment that already happened in the same transaction,
   * so a rejected attempt never quietly counts against a budget for a send
   * that didn't happen.
   */
  reserveSend(email: string, now: Date, globalDailyLimit: number): Promise<EmailBudgetDecision>;
}
