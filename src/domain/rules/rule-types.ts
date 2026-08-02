/**
 * Versioned rule constants — §2.8.
 *
 * "Every rule in this part is versioned data, not a constant buried in a
 * function." Program terms change and they change without notice, so every
 * threshold carries the date it was last verified and the source it was
 * verified against. §13.2 item 4 names this as the entire mitigation for the
 * spec's most perishable assumption.
 *
 * A grep for a bare `250` or `500` inside `src/domain/engine/` is a bug.
 */

/** How stale a rule may get before the UI flags it — §2.8. */
export const RULE_STALENESS_DAYS = 180;

export type RuleCategory =
  | 'PRICE_MATCH'
  | 'STATEMENT_CREDIT'
  | 'POINTS'
  | 'PERKS'
  | 'BRG'
  | 'CHANNEL'
  | 'REBATE';

/**
 * One auditable rule. Rendered verbatim on `/settings/rules` with its value,
 * last-verified date, source link, and a "flag as changed" button.
 */
export interface RuleConstant<T> {
  /** Stable identifier, used by `rule_flags.rule_key`. Never renamed. */
  readonly key: string;
  /** Human-readable name for `/settings/rules`. */
  readonly label: string;
  /** What this rule governs, and why it is set here. */
  readonly description: string;
  readonly category: RuleCategory;
  readonly value: T;
  /** Unit hint so the UI can render `1240` as "12.40%" rather than "1240". */
  readonly unit: 'cents' | 'bps' | 'micro' | 'nights' | 'hours' | 'count' | 'boolean' | 'percent';
  /** ISO date. Verified against `sourceUrl` on this day. */
  readonly verifiedOn: string;
  readonly sourceUrl: string;
}

export function defineRule<T>(rule: RuleConstant<T>): RuleConstant<T> {
  return Object.freeze(rule);
}

/**
 * Whether a rule is older than the staleness window. Takes `now` as a
 * parameter — no `Date.now()` in the domain.
 */
export function isRuleStale(rule: RuleConstant<unknown>, now: Date): boolean {
  const verified = new Date(`${rule.verifiedOn}T00:00:00Z`);
  if (Number.isNaN(verified.getTime())) return true;
  const ageDays = (now.getTime() - verified.getTime()) / 86_400_000;
  return ageDays > RULE_STALENESS_DAYS;
}

export function ruleAgeDays(rule: RuleConstant<unknown>, now: Date): number {
  const verified = new Date(`${rule.verifiedOn}T00:00:00Z`);
  if (Number.isNaN(verified.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - verified.getTime()) / 86_400_000);
}

/** The date every rule in this build was verified against its source — §2.9. */
export const VERIFIED_ON = '2026-07-27';
