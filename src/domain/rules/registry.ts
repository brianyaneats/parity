import { isRuleStale, ruleAgeDays, type RuleConstant, type RuleCategory } from './rule-types';
import { PRICE_MATCH_RULES } from './price-match.rules';
import { CREDIT_RULES } from './credit.rules';
import { POINTS_RULES } from './points.rules';
import { PERKS_RULES } from './perks.rules';
import { BRG_RULES } from './brg.rules';
import { FORA_RULES } from './fora.rules';
import { CHANNEL_CATALOG_RULE } from './channels.rules';

/**
 * The rule registry — §2.8.
 *
 * "Every rule constant renders in a `/settings/rules` screen showing value,
 * last-verified date, and source link, with a 'flag as changed' button."
 *
 * This is the list that screen renders and that `GET /api/rules` returns. If a
 * threshold exists in the engine but not here, the user cannot see it, cannot
 * challenge it, and cannot tell us the programme changed — which §13.2 item 4
 * identifies as the spec's most perishable assumption.
 */
export const ALL_RULES: readonly RuleConstant<unknown>[] = Object.freeze([
  CHANNEL_CATALOG_RULE,
  ...PRICE_MATCH_RULES,
  ...CREDIT_RULES,
  ...POINTS_RULES,
  ...PERKS_RULES,
  ...BRG_RULES,
  ...FORA_RULES,
] as RuleConstant<unknown>[]);

export const RULE_CATEGORY_LABELS: Readonly<Record<RuleCategory, string>> = Object.freeze({
  PRICE_MATCH: 'Price match',
  STATEMENT_CREDIT: 'Statement credits',
  POINTS: 'Points and valuations',
  PERKS: 'Perks',
  BRG: 'Chain best-rate guarantees',
  CHANNEL: 'Channels',
  REBATE: 'Rebates',
});

export interface RuleView {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly category: RuleCategory;
  readonly categoryLabel: string;
  readonly value: unknown;
  readonly unit: RuleConstant<unknown>['unit'];
  readonly verifiedOn: string;
  readonly sourceUrl: string;
  readonly ageDays: number;
  readonly stale: boolean;
}

/** Projects the registry for the rules screen. Takes `now` — no ambient clock. */
export function buildRuleViews(now: Date): readonly RuleView[] {
  return ALL_RULES.map((rule) => ({
    key: rule.key,
    label: rule.label,
    description: rule.description,
    category: rule.category,
    categoryLabel: RULE_CATEGORY_LABELS[rule.category],
    value: rule.value,
    unit: rule.unit,
    verifiedOn: rule.verifiedOn,
    sourceUrl: rule.sourceUrl,
    ageDays: ruleAgeDays(rule, now),
    stale: isRuleStale(rule, now),
  }));
}

export function findRule(key: string): RuleConstant<unknown> | undefined {
  return ALL_RULES.find((rule) => rule.key === key);
}

/** Rules past the staleness window — feeds the weekly digest job in Part 9. */
export function staleRules(now: Date): readonly RuleConstant<unknown>[] {
  return ALL_RULES.filter((rule) => isRuleStale(rule, now));
}

/**
 * Renders a rule value for display. The unit hint is what turns a bare `1240`
 * into "12.40%" instead of a number the user has to decode.
 */
export function formatRuleValue(rule: Pick<RuleConstant<unknown>, 'value' | 'unit'>): string {
  const { value, unit } = rule;
  switch (unit) {
    case 'cents':
      return typeof value === 'number'
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100)
        : String(value);
    case 'bps':
      return typeof value === 'number' ? `${(value / 100).toFixed(2)}%` : String(value);
    case 'micro':
      return typeof value === 'number' ? `${(value / 10_000).toFixed(2)}¢ per point` : String(value);
    case 'percent':
      return typeof value === 'number' ? `${value}%` : String(value);
    case 'nights':
      return typeof value === 'number' ? `${value} night${value === 1 ? '' : 's'}` : String(value);
    case 'hours':
      return typeof value === 'number' ? `${value} hour${value === 1 ? '' : 's'}` : String(value);
    case 'boolean':
      return value === true ? 'Yes' : 'No';
    case 'count':
      return Array.isArray(value) ? value.join(', ') : String(value);
    default:
      return String(value);
  }
}
